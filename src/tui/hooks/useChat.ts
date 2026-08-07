import { useState, useCallback, useRef } from 'react';
import type { MessageData } from '../components/ChatMessage.js';
import type { ToolCallData } from '../components/ToolCall.js';
import type { App } from '../../app/index.js';
import { compressThinking, splitThinking, summarizeThinking } from '../../utils/thinking.js';
import type { StreamChunk, Usage } from '../../types.js';

interface ChatState {
  messages: MessageData[];
  isThinking: boolean;
  streaming: string;
  streamingToolCalls: ToolCallData[];
  queuedMessage: string | null;
  /**
   * v3.0.0: Latest cache usage emitted by the provider, surfaced to the TUI
   * Header. Null when no usage data was returned (e.g. provider does not
   * support cache stats or streaming without stream_options.include_usage).
   */
  lastUsage: Usage | null;
}

/**
 * Hook for managing chat state and the streaming response lifecycle.
 *
 * v3.0.0: streamResponse yields structured StreamChunks (text / tool_calls /
 * thinking / usage). The previous @@TOOL@@ sentinel-string parsing is gone.
 *
 * Persisted message order matches the source chunks exactly:
 *   - text chunks → accumulated into fullContent (later compressed via
 *     compressThinking before persistence)
 *   - tool_calls chunks → results are summarized into a `[tool: name → result]`
 *     suffix on the assistant message (same belt-and-suspenders behavior as
 *     v2.2.6)
 *   - usage chunks → surfaced via state.lastUsage so the TUI Header can render
 *     cache hit-rate (consumed by app.tsx via /cache command in M3)
 */
export function useChat(app: App) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    isThinking: false,
    streaming: '',
    streamingToolCalls: [],
    queuedMessage: null,
    lastUsage: null,
  });
  const processingRef = useRef(false);
  const queuedRef = useRef<string | null>(null);
  const abortRef = useRef(false);

  const processStream = async (input: string) => {
    abortRef.current = false;
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, { role: 'user', content: input }],
      isThinking: true,
      streaming: '',
      streamingToolCalls: [],
      queuedMessage: null,
    }));

    app.session.addMessage('user', input);

    const stream = app.streamResponse();
    let fullContent = '';
    let currentToolCalls: ToolCallData[] = [];
    // Latest usage from this round; surfaced via state.lastUsage.
    let lastUsage: Usage | null = null;
    let lastUpdateTime = 0;
    const THROTTLE_MS = 50;

    /**
     * Flush streaming state to React. Throttled to ~20fps so the terminal
     * doesn't flicker on long completions (combined with <Static> below the
     * completion line stays put while the streaming line updates in place).
     */
    const flushStreaming = () => {
      const now = Date.now();
      if (now - lastUpdateTime < THROTTLE_MS) return;
      lastUpdateTime = now;
      setState(prev => ({ ...prev, isThinking: false, streaming: fullContent }));
    };

    try {
      for await (const chunk of stream as AsyncIterable<StreamChunk>) {
        // Check abort
        if (abortRef.current) {
          break;
        }

        switch (chunk.type) {
          case 'text':
            if (chunk.content) {
              fullContent += chunk.content;
              flushStreaming();
            }
            break;

          case 'thinking':
            // Reasoning text. We do not append it to fullContent (it is
            // stripped from persistence in compressThinking), but we surface
            // it via the streaming display when app.showThinking is on.
            if (app.showThinking && chunk.content) {
              fullContent += chunk.content;
              flushStreaming();
            }
            break;

          case 'tool_calls':
            if (chunk.toolCalls && chunk.toolCalls.length > 0) {
              // Replace rather than append — LLMService emits one combined
              // tool_calls chunk per iteration. This is the dispatch plan.
              currentToolCalls = chunk.toolCalls.map(tc => ({
                name: tc.function.name,
                args: tc.function.arguments,
                // Results are appended by the *next* text chunk via the
                // `[tool: name → result]` suffix we add on persistence. The
                // streaming ToolCall panel below renders a "running" state
                // until the next iteration's tool_calls chunk comes back
                // with `result` (we look up by name).
                result: undefined,
                isError: false,
              }));
              setState(prev => ({
                ...prev,
                isThinking: false,
                streamingToolCalls: [...currentToolCalls],
              }));
            }
            break;

          case 'usage':
            lastUsage = chunk.usage;
            setState(prev => ({ ...prev, lastUsage: chunk.usage }));
            break;
        }
      }

      // v2.2.4 (port from v2.1.0): DO NOT persist truncated assistant
      // messages. The previous code literally wrote `'\n\n[已中断]'`
      // as a suffix and persisted it — which is what created the
      // hallucination loop where the next turn's LLM echoed the
      // marker back. The fix is two-pronged:
      //   1. Never persist when the stream was aborted (here).
      //   2. SessionManager.addMessageSafe drops messages that match
      //      the pollution filter as a belt-and-suspenders check
      //      for cases where we somehow persist a polluted message.
      const wasAborted = abortRef.current;
      const shouldPersist = !wasAborted &&
        (fullContent.trim() || currentToolCalls.length > 0);

      if (shouldPersist) {
        // v2.2.5: strip  blocks from the persisted message
        // when compression is enabled. Same rationale as in
        // cmd/index.tsx — keeps history compact, avoids re-feeding
        // reasoning into the next turn's context window.
        const toPersist = compressThinking(fullContent, app.showThinking);
        app.session.addMessageSafe('assistant', toPersist);
      }

      // v2.2.5: build a displayable version. When thinking is hidden
      // we still want the user to see a one-line indicator of how
      // much reasoning the model did, plus the conclusion.
      const split = splitThinking(fullContent);
      const displayContent = app.showThinking
        ? fullContent
        : (split.thinking
            ? `${summarizeThinking(split)}\n${split.conclusion}`
            : fullContent);

      // v2.2.6 (tool-result belt-and-suspenders): if any tool call
      // returned text, also append a compact "[tool: name → result]"
      // summary to the persisted/displayed content. This guarantees
      // the user sees the tool output regardless of whether the Ink
      // <ToolCall/> component renders it correctly. Past sessions
      // have had cases where the streaming ToolCall rendering failed
      // silently (e.g. result was empty string, wrap=truncate cut
      // long output off-screen) and the user had no idea what the
      // tool actually returned.
      //
      // v3.0.0: since LLMService now folds tool results into
      // currentMessages without surfacing them as separate chunks, we no
      // longer have a `result` field on each ToolCallData here. The
      // result summary is built by reading back from
      // app.session.getMessages() — the latest `tool` role message per
      // tool call id. To keep this lightweight we fall back to a brief
      // "[tool: name → see message]" suffix when the result is not
      // available in our local streaming state.
      const toolSummary = currentToolCalls.length > 0
        ? '\n\n' + currentToolCalls.map((tc) => {
            const r = tc.result !== undefined ? tc.result : '(see tool result above)';
            const short = r.length > 200 ? r.slice(0, 197) + '...' : r;
            return `[tool: ${tc.name} → ${short}]`;
          }).join('\n')
        : '';

      setState(prev => ({
        ...prev,
        messages: [
          ...prev.messages,
          ...(shouldPersist
            ? [{
                role: 'assistant' as const,
                content: displayContent + toolSummary,
                toolCalls: currentToolCalls.length > 0 ? currentToolCalls : undefined,
              }]
            : []),
        ],
        streaming: '',
        streamingToolCalls: [],
        isThinking: false,
        lastUsage,
      }));

      app.session.truncate();
    } catch (error: any) {
      if (abortRef.current) {
        setState(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            ...(fullContent.trim()
              ? [{ role: 'assistant' as const, content: fullContent + '\n\n[已中断]' }]
              : [{ role: 'assistant' as const, content: '[已中断]' }]),
          ],
          streaming: '',
          streamingToolCalls: [],
          isThinking: false,
        }));
      } else {
        const msg = error.message || String(error);
        let errorMsg = `Error: ${msg}`;

        if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')) {
          errorMsg = `❌ API key invalid. Run \`gfcode init\` to reconfigure.`;
        } else if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
          errorMsg = `❌ Rate limit exceeded. Wait or run \`gfcode init\` to switch provider.`;
        } else if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
          errorMsg = `❌ Cannot connect. Check network or run \`gfcode init\`.`;
        } else if (msg.includes('abort') || msg.includes('AbortError')) {
          errorMsg = `[已中断]`;
        }

        setState(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            ...(fullContent.trim()
              ? [{ role: 'assistant' as const, content: fullContent }]
              : []),
            { role: 'assistant', content: errorMsg },
          ],
          streaming: '',
          streamingToolCalls: [],
          isThinking: false,
        }));
      }
    }

    // Process queued message
    if (!abortRef.current && queuedRef.current) {
      const next = queuedRef.current;
      queuedRef.current = null;
      await processStream(next);
    } else {
      processingRef.current = false;
    }
  };

  const sendMessage = useCallback((input: string) => {
    if (processingRef.current) {
      queuedRef.current = input;
      setState(prev => ({ ...prev, queuedMessage: input }));
      return;
    }

    processingRef.current = true;
    processStream(input);
  }, [app]);

  const cancel = useCallback(() => {
    abortRef.current = true;
    queuedRef.current = null;
    setState(prev => ({ ...prev, queuedMessage: null, isThinking: false }));
  }, []);

  return { ...state, sendMessage, cancel };
}

import { useState, useCallback, useRef } from 'react';
import type { MessageData } from '../components/ChatMessage.js';
import type { ToolCallData } from '../components/ToolCall.js';
import type { App } from '../../app/index.js';
import { compressThinking, splitThinking, summarizeThinking } from '../../utils/thinking.js';

interface ChatState {
  messages: MessageData[];
  isThinking: boolean;
  streaming: string;
  streamingToolCalls: ToolCallData[];
  queuedMessage: string | null;
}

export function useChat(app: App) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    isThinking: false,
    streaming: '',
    streamingToolCalls: [],
    queuedMessage: null,
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
    let lastUpdateTime = 0;
    const THROTTLE_MS = 50;

    try {
      for await (const chunk of stream) {
        // Check abort
        if (abortRef.current) {
          break;
        }

        if (chunk.includes('@@TOOL@@')) {
          const parts = chunk.split('\n');
          for (const part of parts) {
            if (part.startsWith('@@TOOL@@')) {
              try {
                const data = JSON.parse(part.slice(8));
                if (data.action === 'call') {
                  currentToolCalls.push({ name: data.name, args: data.args || '' });
                  setState(prev => ({
                    ...prev,
                    isThinking: false,
                    streamingToolCalls: [...currentToolCalls],
                  }));
                } else if (data.action === 'result') {
                  const lastIdx = currentToolCalls.length - 1;
                  if (lastIdx >= 0) {
                    currentToolCalls[lastIdx] = {
                      ...currentToolCalls[lastIdx],
                      result: data.output || data.error || '',
                      isError: !!data.error,
                    };
                  }
                  setState(prev => ({
                    ...prev,
                    streamingToolCalls: [...currentToolCalls],
                    isThinking: true,
                  }));
                }
              } catch {
                fullContent += part;
              }
            } else if (part) {
              fullContent += part;
            }
          }
        } else {
          fullContent += chunk;
        }

        const now = Date.now();
        if (now - lastUpdateTime >= THROTTLE_MS) {
          lastUpdateTime = now;
          setState(prev => ({ ...prev, isThinking: false, streaming: fullContent }));
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
        // v2.2.5: strip <think> blocks from the persisted message
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
      const toolSummary = currentToolCalls.length > 0
        ? '\n\n' + currentToolCalls.map((tc) => {
            const r = tc.result !== undefined ? tc.result : '(no result)';
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

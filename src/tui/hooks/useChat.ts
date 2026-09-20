import { useState, useCallback, useRef } from 'react';
import type { MessageData } from '../components/ChatMessage.js';
import { formatToolLabel, formatToolResultLine } from '../components/ToolCall.js';
import type { App } from '../../app/index.js';
import { compressThinking } from '../../utils/thinking.js';
import { formatTokens } from '../../utils/tokens.js';
import { getVersion } from '../../version.js';
import type { StreamChunk, ToolCall, ToolCallResult, Usage } from '../../types.js';

interface ChatState {
  /**
   * Everything the user sees EXCEPT the current text run — user messages,
   * committed assistant runs, ⎿ tool lines, chips, notices — as immutable
   * entries. v3.3.0: rendered by the alt-screen viewport window
   * (app.tsx buildWindow), no longer via Ink <Static>.
   */
  messages: MessageData[];
  /**
   * v3.3.0: the CURRENT text run, re-rendered as one growing markdown
   * block in the live frame (null when no text is streaming). Committed
   * as a real message at every boundary — a 200ms batch of Chinese is a
   * handful of chars, so per-batch lines wrapped into a narrow ragged
   * column (user report: 输出只在左侧).
   */
  streamingView: string | null;
  isThinking: boolean;
  queuedMessage: string | null;
  /** Latest usage from the provider (cache chips / auto-compact checks). */
  lastUsage: Usage | null;
}

/**
 * Hook for managing chat state and the streaming response lifecycle.
 *
 * v3.3.0 (live-paragraph rendering, mcode stable-tail idea): streamed text
 * accumulates in a view buffer that re-renders as ONE growing markdown
 * block every ~200ms; the block commits as a real assistant message at
 * every boundary (tool line, round end). Earlier designs shipped per-batch
 * lines: 3.0.15/16 wrote to stdout beside the Ink frame (the `┏━━┓`
 * stamping bug), 3.0.18 moved everything into <Static> items (which
 * wrapped Chinese streams into a narrow ragged column — each 200ms batch
 * is only a handful of CJK chars).
 *
 * Persisted message order still matches the source chunks exactly:
 *   - text chunks → accumulated into fullContent (compressed via
 *     compressThinking before persistence)
 *   - tool_calls chunks → session/agent-loop behavior unchanged
 *   - usage chunks → lastUsage state + auto-compact check
 */

const FLUSH_MS = 200;

export function useChat(app: App) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    streamingView: null,
    isThinking: false,
    queuedMessage: null,
    lastUsage: null,
  });
  const processingRef = useRef(false);
  /** v3.0.18 fix: FIFO queue — an array, so a second queued input can no
   * longer overwrite (and silently drop) the first one. */
  const queuedRef = useRef<string[]>([]);
  const abortRef = useRef(false);
  // v3.0.5: real AbortController — cancel aborts the provider fetch.
  const abortCtrlRef = useRef<AbortController | null>(null);
  /** Brand header is committed once per process. */
  const headerCommittedRef = useRef(false);

  /** Append an immutable item to the Static list. */
  const commit = useCallback((item: Partial<MessageData> & { content: string }) => {
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, { role: 'assistant' as const, ...item } as MessageData],
    }));
  }, []);

  const processStream = async (input: string) => {
    abortRef.current = false;
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;
    commit({ role: 'user', content: input } as any);
    // Show whatever is still waiting behind this message (empty → clear).
    setState(prev => ({
      ...prev,
      isThinking: true,
      queuedMessage: queuedRef.current.length > 0 ? queuedRef.current.join(' │ ') : null,
    }));

    app.session.addMessage('user', input);

    // ── streamed-text LIVE rendering (v3.3.0, mcode stable-tail idea) ──
    // The current text run accumulates in viewRef and re-renders as ONE
    // growing markdown block in the live frame every FLUSH_MS. Committing
    // each batch as its own Static line (the old design) wrapped Chinese
    // streams into a narrow ragged column — a 200ms batch of Chinese is
    // only a handful of chars. The block is committed as a real assistant
    // message at every boundary (tool line, round end), so history keeps
    // the model's paragraph structure.
    let viewText = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushText = () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      setState(prev => ({ ...prev, streamingView: viewText || null }));
    };
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => { flushTimer = null; flushText(); }, FLUSH_MS);
      flushTimer.unref?.();
    };
    const writeText = (s: string) => { viewText += s; scheduleFlush(); };
    /** Commit the accumulated live block as ONE markdown message. */
    const commitStreamedView = () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (!viewText) { setState(prev => ({ ...prev, streamingView: null })); return; }
      const content = viewText;
      viewText = '';
      commit({ role: 'assistant', content });
      setState(prev => ({ ...prev, streamingView: null }));
    };

    const cfgModel = app.config.get().model || '';
    /** Dim plain line (tool calls, chips, stats). The live block lands
     * BEFORE the ⎿ line it preceded (chronological order). */
    const commitDim = (line: string) => { commitStreamedView(); commit({ content: line, plain: true, dim: true }); };

    // First turn in this session: brand header as Static items.
    if (!headerCommittedRef.current) {
      headerCommittedRef.current = true;
      const cols = process.stdout.columns || 80;
      commit({ content: `◆ THATGFSJ v${getVersion()}`, plain: true, dim: true });
      commit({ content: '─'.repeat(Math.max(20, cols - 2)), plain: true, dim: true });
    }
    // v3.3.0: the per-message label now lives with the message itself —
    // the committed assistant message and the live block each render their
    // own ▪ line (the old separate label Static line duplicated them).

    /** Pending `⎿ name(args) ⟳` line. */
    const writePendingLine = (tc: ToolCall) => {
      const { title, detail } = formatToolLabel(tc.function.name, tc.function.arguments);
      commitDim(`  ⎿ ${title}${detail ? ' ' + detail : ''} ⟳`);
    };

    /** Result summary line, same shape as <ToolCall/>. */
    const writeResultLine = (r: ToolCallResult) => {
      const line = formatToolResultLine(r.output, !r.ok);
      if (line) commitDim(`    ${line.text}`);
    };

    const stream = app.streamResponse(undefined, { signal: ctrl.signal });
    let fullContent = '';
    let sawToolCalls = false;
    let lastUsage: Usage | null = null;
    // v3.0.13: completion tokens summed across all rounds of this turn.
    let turnCompletionTokens = 0;
    let sawOutput = false;

    try {
      for await (const chunk of stream as AsyncIterable<StreamChunk>) {
        if (abortRef.current) break;

        switch (chunk.type) {
          case 'text':
            if (chunk.content) {
              fullContent += chunk.content;
              if (!sawOutput) { sawOutput = true; setState(prev => ({ ...prev, isThinking: false })); }
              writeText(chunk.content);
            }
            break;

          case 'thinking':
            // Reasoning text: not part of fullContent unless showThinking.
            if (app.showThinking && chunk.content) {
              if (!sawOutput) { sawOutput = true; setState(prev => ({ ...prev, isThinking: false })); }
              writeText(chunk.content);
            }
            break;

          case 'tool_calls':
            if (chunk.toolCalls && chunk.toolCalls.length > 0) {
              sawToolCalls = true;
              if (!sawOutput) { sawOutput = true; setState(prev => ({ ...prev, isThinking: false })); }
              if (chunk.pending) {
                for (const tc of chunk.toolCalls) writePendingLine(tc);
              } else {
                for (const r of chunk.results || []) writeResultLine(r);
              }
            }
            break;

          case 'usage':
            lastUsage = chunk.usage;
            turnCompletionTokens += chunk.usage.completion_tokens || 0;
            setState(prev => ({ ...prev, lastUsage: chunk.usage }));
            break;
        }
      }
      commitStreamedView();

      // v2.2.4: never persist aborted/truncated assistant messages (the
      // [已中断] hallucination loop — see SessionManager.addMessageSafe).
      const wasAborted = abortRef.current;
      const shouldPersist = !wasAborted && (fullContent.trim() || sawToolCalls);

      if (shouldPersist) {
        const toPersist = compressThinking(fullContent, app.showThinking);
        app.session.addMessageSafe('assistant', toPersist);
      }

      if (shouldPersist && turnCompletionTokens > 0) {
        commitDim(`  · ${formatTokens(turnCompletionTokens)}t`);
      }

      // v3.2.1: the per-round stats chip (ctx … · ↑… ↓… · 节省 ¥…) is GONE —
      // it printed once per round and never moved (the user called it
      // 摆设), and the money line is not wanted. The right-side context
      // panel now carries all of it LIVE (used/window, ↑ input, ↓ output,
      // hit rate) with no cost estimate anywhere in the TUI.

      setState(prev => ({ ...prev, isThinking: false, lastUsage }));

      // v3.0.13: auto-compact at 85% of the model's context window.
      const compactNotice = app.maybeAutoCompact(lastUsage ?? undefined);
      if (compactNotice) {
        commit({ content: compactNotice });
      }

      app.session.persist();

      // v3.1.0: the turn is REALLY done (all rounds, stats, persistence).
      // Plan mode's approval dialog triggers from here.
      if (!wasAborted) app.onTurnComplete?.();
    } catch (error: any) {
      commitStreamedView();
      if (abortRef.current) {
        commit({ content: '[已中断]', plain: true });
        setState(prev => ({ ...prev, isThinking: false }));
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

        commit({ content: errorMsg });
        setState(prev => ({ ...prev, isThinking: false }));
      }
    }

    // Process queued messages: consume EVERYTHING that piled up during the
    // turn, in order (previously only the last input survived an overwrite).
    if (!abortRef.current && queuedRef.current.length > 0) {
      const next = queuedRef.current.shift()!;
      await processStream(next);
    } else {
      queuedRef.current = [];
      processingRef.current = false;
    }
  };

  const sendMessage = useCallback((input: string) => {
    if (processingRef.current) {
      queuedRef.current.push(input);
      setState(prev => ({ ...prev, queuedMessage: queuedRef.current.join(' │ ') }));
      return;
    }

    processingRef.current = true;
    processStream(input);
  }, [app]);

  const cancel = useCallback(() => {
    abortRef.current = true;
    // v3.0.5: abort the actual HTTP request, not just the render loop.
    abortCtrlRef.current?.abort();
    queuedRef.current = [];
    setState(prev => ({ ...prev, queuedMessage: null, isThinking: false }));
  }, []);

  /**
   * v3.0.5: /resume hydration — put a restored conversation into the chat
   * list so the user sees the loaded history instead of an empty screen.
   */
  const hydrateMessages = useCallback((msgs: MessageData[]) => {
    setState(prev => ({ ...prev, messages: msgs }));
  }, []);

  /** v3.0.16: /new clears the display list (session.reset keeps prompt). */
  const clearMessages = useCallback(() => {
    setState(prev => ({ ...prev, messages: [] }));
  }, []);

  return { ...state, sendMessage, cancel, hydrateMessages, clearMessages };
}

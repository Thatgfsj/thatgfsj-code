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
   * The Static item list. EVERYTHING the user sees — user messages, streamed
   * assistant text (in batched plain chunks), tool lines, stats, notices —
   * lives here as immutable entries. Ink's <Static> renders each entry
   * exactly once into the terminal scrollback and never touches it again,
   * which is what keeps the mouse wheel usable while streaming.
   */
  messages: MessageData[];
  isThinking: boolean;
  queuedMessage: string | null;
  /** Latest usage from the provider (cache chips / auto-compact checks). */
  lastUsage: Usage | null;
}

/**
 * Hook for managing chat state and the streaming response lifecycle.
 *
 * v3.0.18 (final scroll fix — "everything is Static"): the previous
 * attempt (3.0.15/16) wrote streamed text to stdout BESIDE the live Ink
 * frame. Manual writes move the cursor without telling Ink, so Ink's next
 * frame redraw of the (constant-height) input box stomped old frame
 * copies into the middle of the streamed text — the `┏━━┓` stamping the
 * user reported. The robust design, per the Claude Code architecture
 * study, is simpler:
 *
 *   - streamed text is buffered and committed as NEW <Static> items every
 *     ~200ms (Static renders each item once, then never re-renders it —
 *     Ink manages all cursor movement itself);
 *   - tool pending/result lines, the token chip, and the per-round stats
 *     line are Static items too;
 *   - the live frame is ONLY the constant-height region (thinking spinner
 *     + input box + queue notice).
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

    // ── streamed-text batching ──
    let pendingText = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    /**
     * final=true flushes everything (round end). Otherwise the trailing
     * partial word stays buffered: every Static item prints on its own
     * line, so flushing at an arbitrary character would split words
     * across lines ("Thatg / fsj" — user-visible mid-word breaks).
     */
    const flushText = (final = false) => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (!pendingText) return;
      let chunk = pendingText;
      if (!final && !/\s$/.test(chunk)) {
        const cut = Math.max(chunk.lastIndexOf(' '), chunk.lastIndexOf('\n')) + 1;
        if (cut > 0) {
          pendingText = chunk.slice(cut);
          chunk = chunk.slice(0, cut);
        } else if (chunk.length < 500) {
          return; // one long partial word — keep buffering
        } else {
          pendingText = '';
        }
      } else {
        pendingText = '';
      }
      commit({ content: chunk, plain: true });
    };
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => { flushTimer = null; flushText(); }, FLUSH_MS);
      flushTimer.unref?.();
    };
    const writeText = (s: string) => { pendingText += s; scheduleFlush(); };

    const cfgModel = app.config.get().model || '';
    /** Dim plain line (tool calls, chips, stats). */
    const commitDim = (line: string) => { flushText(); commit({ content: line, plain: true, dim: true }); };

    // First turn in this session: brand header as Static items.
    if (!headerCommittedRef.current) {
      headerCommittedRef.current = true;
      const cols = process.stdout.columns || 80;
      commit({ content: `◆ THATGFSJ v${getVersion()}`, plain: true, dim: true });
      commit({ content: '─'.repeat(Math.max(20, cols - 2)), plain: true, dim: true });
    }
    // Assistant label line (once per turn, before the first streamed char).
    let labelWritten = false;
    const writeLabelOnce = () => {
      if (labelWritten) return;
      labelWritten = true;
      commitDim(`▪ Build${cfgModel ? ` · ${cfgModel}` : ''}`);
    };

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
              if (!sawOutput) { sawOutput = true; writeLabelOnce(); setState(prev => ({ ...prev, isThinking: false })); }
              writeText(chunk.content);
            }
            break;

          case 'thinking':
            // Reasoning text: not part of fullContent unless showThinking.
            if (app.showThinking && chunk.content) {
              if (!sawOutput) { sawOutput = true; writeLabelOnce(); setState(prev => ({ ...prev, isThinking: false })); }
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
      flushText(true);

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
      flushText(true);
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

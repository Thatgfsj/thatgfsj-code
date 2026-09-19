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
  const queuedRef = useRef<string | null>(null);
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
    setState(prev => ({ ...prev, isThinking: true, queuedMessage: null }));

    app.session.addMessage('user', input);

    // ── streamed-text batching ──
    let pendingText = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushText = () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (!pendingText) return;
      const chunk = pendingText;
      pendingText = '';
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
      flushText();

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

      // v3.0.16: per-round session stats line (chat mode's replacement for
      // the StatusBar — a live StatusBar re-stamps via frame redraws; a
      // Static line is permanent). Defensive against stub apps in tests.
      let stats: any = { promptTokens: 0, completionTokens: 0 };
      let win = 128000;
      let snap: any = { totalInputTokens: 0, estimatedSavingsCNY: 0 };
      try {
        stats = (app as any).sessionStats ?? stats;
        win = (typeof (app as any).getContextWindow === 'function' ? (app as any).getContextWindow() : win) || win;
        if (typeof (app as any).cacheStats?.snapshot === 'function') snap = (app as any).cacheStats.snapshot();
      } catch { /* keep defaults */ }
      const pct = stats.promptTokens > 0 && win > 0
        ? Math.min(999, Math.round((stats.promptTokens / win) * 100))
        : 0;
      commitDim(
        `  ctx ${formatTokens(stats.promptTokens)}/${formatTokens(win)} (${pct}%)` +
        ` · ↑${formatTokens(snap.totalInputTokens ?? 0)} ↓${formatTokens(stats.completionTokens ?? 0)}` +
        ` · 节省 ¥${Number(snap.estimatedSavingsCNY ?? 0).toFixed(2)}`,
      );

      setState(prev => ({ ...prev, isThinking: false, lastUsage }));

      // v3.0.13: auto-compact at 85% of the model's context window.
      const compactNotice = app.maybeAutoCompact(lastUsage ?? undefined);
      if (compactNotice) {
        commit({ content: compactNotice });
      }

      app.session.persist();
    } catch (error: any) {
      flushText();
      if (abortRef.current) {
        commit({ content: '[已中断]' });
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
    // v3.0.5: abort the actual HTTP request, not just the render loop.
    abortCtrlRef.current?.abort();
    queuedRef.current = null;
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

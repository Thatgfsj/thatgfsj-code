import { useState, useCallback, useRef } from 'react';
import { useStdout } from 'ink';
import chalk from 'chalk';
import type { MessageData } from '../components/ChatMessage.js';
import { formatToolLabel, formatToolResultLine } from '../components/ToolCall.js';
import type { App } from '../../app/index.js';
import { compressThinking } from '../../utils/thinking.js';
import { formatTokens } from '../../utils/tokens.js';
import { theme } from '../theme.js';
import type { StreamChunk, ToolCall, ToolCallResult, Usage } from '../../types.js';

interface ChatState {
  /**
   * v3.0.16: DISPLAY-ONLY message list. Completed assistant text no longer
   * lives here — it is committed straight into the terminal scrollback while
   * streaming (claude-code style append-only rendering), so the list only
   * carries user messages, errors and notices (auto-compact, /commands…).
   */
  messages: MessageData[];
  isThinking: boolean;
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
 * v3.0.16 (scroll-wheel fix, claude-code "two-region" rendering):
 * streaming text/tool lines are NO LONGER React state. The old design kept
 * the growing text in `streaming` state, so Ink re-rendered (and re-erase/
 * redrew) an ever-taller frame on every chunk — dragging the viewport back
 * to the bottom and locking the mouse wheel. Now:
 *
 *   - completed region: past messages via <Static> + streamed text/tool
 *     lines written straight to stdout through Ink's `useStdout().write()`
 *     (erase current frame → append text permanently → redraw frame below),
 *     batched to a ~30fps frame budget;
 *   - live region: a CONSTANT-height frame (thinking spinner + input +
 *     status bar + queue notice; the ChatList contributes 0 lines because
 *     it only renders <Static>). Row count never grows while streaming,
 *     so the terminal never auto-scrolls and the wheel stays usable.
 *
 * Persisted message order still matches the source chunks exactly:
 *   - text chunks → accumulated into fullContent (compressed via
 *     compressThinking before persistence)
 *   - tool_calls chunks → session/agent-loop behavior unchanged
 *   - usage chunks → surfaced via state.lastUsage for the TUI Header
 */

/** Batched writer: appends text to the permanent scrollback region. */
class StreamWriter {
  private buffer = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 3.0.9 assistant label, printed once before the first streamed char. */
  private labelWritten = false;

  constructor(
    private readonly emit: (data: string) => void,
    private readonly label: string,
    private readonly throttleMs = 33,
  ) {}

  /** Queue a raw chunk of assistant text (label auto-prefixed once). */
  text(s: string): void {
    if (!s) return;
    if (!this.labelWritten) {
      this.labelWritten = true;
      this.buffer += '\n' + chalk.hex(theme.textFaint)(this.label) + '\n';
    }
    this.buffer += s;
    this.schedule();
  }

  /** Write immediately (tool lines / notices), flushing queued text first. */
  now(data: string): void {
    this.flush();
    this.emit(data);
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.throttleMs);
    this.timer.unref?.();
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.buffer) return;
    const data = this.buffer;
    this.buffer = '';
    this.emit(data);
  }
}

export function useChat(app: App) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    isThinking: false,
    queuedMessage: null,
    lastUsage: null,
  });
  // Ink's managed write: erase frame → write data permanently → redraw the
  // (constant-height) frame below it. Falls back to raw stdout outside Ink.
  const { write: inkWrite } = useStdout();
  const processingRef = useRef(false);
  const queuedRef = useRef<string | null>(null);
  const abortRef = useRef(false);
  // v3.0.5: real AbortController — cancel now aborts the provider fetch
  // instead of only stopping the render loop while tokens keep generating.
  const abortCtrlRef = useRef<AbortController | null>(null);

  const processStream = async (input: string) => {
    abortRef.current = false;
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, { role: 'user', content: input }],
      isThinking: true,
      queuedMessage: null,
    }));

    app.session.addMessage('user', input);

    const emit = (data: string) => {
      if (inkWrite) inkWrite(data);
      else process.stdout.write(data);
    };
    const cfgModel = app.config.get().model || '';
    const writer = new StreamWriter(emit, `▪ Build${cfgModel ? ` · ${cfgModel}` : ''}`);

    /** Pending `⎿ name(args) ⟳` line, colored like the <ToolCall/> component. */
    const writePendingLine = (tc: ToolCall) => {
      const { title, detail } = formatToolLabel(tc.function.name, tc.function.arguments);
      writer.now(
        '  ' +
        chalk.hex(theme.toolMark)('⎿ ') +
        chalk.hex(theme.accentDim)(title) +
        (detail ? ' ' + chalk.hex(theme.textDim)(detail) : '') +
        chalk.hex(theme.textFaint)(' ⟳') +
        '\n',
      );
    };

    /** Result summary line, same shape/color rules as <ToolCall/>. */
    const writeResultLine = (r: ToolCallResult) => {
      const line = formatToolResultLine(r.output, !r.ok);
      if (!line) return;
      writer.now('    ' + chalk.hex(line.color)(line.text) + '\n');
    };

    const stream = app.streamResponse(undefined, { signal: ctrl.signal });
    let fullContent = '';
    // Any tool call seen this turn (keeps persistence gating identical).
    let sawToolCalls = false;
    // Latest usage from this round; surfaced via state.lastUsage.
    let lastUsage: Usage | null = null;
    // v3.0.13: completion tokens summed across all rounds of this turn —
    // appended as a faint `· Nt` chip when the turn completes.
    let turnCompletionTokens = 0;
    // Spinner turns off at the first visible output (text or tool line).
    let sawOutput = false;

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
              if (!sawOutput) {
                sawOutput = true;
                setState(prev => ({ ...prev, isThinking: false }));
              }
              writer.text(chunk.content);
            }
            break;

          case 'thinking':
            // Reasoning text. We do not append it to fullContent (it is
            // stripped from persistence in compressThinking), but when
            // showThinking is on it streams straight to the scrollback too.
            if (app.showThinking && chunk.content) {
              fullContent += chunk.content;
              if (!sawOutput) {
                sawOutput = true;
                setState(prev => ({ ...prev, isThinking: false }));
              }
              writer.text(chunk.content);
            }
            break;

          case 'tool_calls':
            if (chunk.toolCalls && chunk.toolCalls.length > 0) {
              sawToolCalls = true;
              if (!sawOutput) {
                sawOutput = true;
                setState(prev => ({ ...prev, isThinking: false }));
              }
              if (chunk.pending) {
                // v3.0.16: pre-execution announcement → one ⟳ line per call.
                for (const tc of chunk.toolCalls) writePendingLine(tc);
              } else {
                // Results chunk: index-aligned outcome line per call.
                const results = chunk.results || [];
                for (const r of results) writeResultLine(r);
              }
            }
            break;

          case 'usage':
            lastUsage = chunk.usage;
            // v3.0.13: sum completion tokens across agent-loop rounds.
            turnCompletionTokens += chunk.usage.completion_tokens || 0;
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
        (fullContent.trim() || sawToolCalls);

      if (shouldPersist) {
        // v2.2.5: strip  blocks from the persisted message
        // when compression is enabled. Same rationale as in
        // cmd/index.tsx — keeps history compact, avoids re-feeding
        // reasoning into the next turn's context window.
        const toPersist = compressThinking(fullContent, app.showThinking);
        app.session.addMessageSafe('assistant', toPersist);
      }

      // Commit whatever is still queued, then the turn's token chip.
      // v2.2.6 note: the old belt-and-suspenders "[tool: name → result]"
      // summary was display-only; result lines are now painted under each
      // ⎿ call line the moment the results chunk arrives, so no suffix.
      writer.flush();
      if (shouldPersist && turnCompletionTokens > 0) {
        emit(chalk.hex(theme.textFaint)(`  · ${formatTokens(turnCompletionTokens)}t\n`));
      }

      // v3.0.16: the assistant text itself is ALREADY in the scrollback
      // (appended live above the frame) — nothing is added to `messages`
      // here. Only notices/errors land in the React display list.
      setState(prev => ({
        ...prev,
        messages: [...prev.messages],
        isThinking: false,
        lastUsage,
      }));

      // v3.0.13: token-aware auto-compact — when this round's prompt tokens
      // reached 85% of the model's context window, compact now and surface
      // the notice in the chat.
      const compactNotice = app.maybeAutoCompact(lastUsage ?? undefined);
      if (compactNotice) {
        setState(prev => ({
          ...prev,
          messages: [...prev.messages, { role: 'assistant' as const, content: compactNotice }],
        }));
      }

      app.session.persist();
    } catch (error: any) {
      writer.flush();
      if (abortRef.current) {
        setState(prev => ({
          ...prev,
          messages: [...prev.messages, { role: 'assistant' as const, content: '[已中断]' }],
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
          messages: [...prev.messages, { role: 'assistant' as const, content: errorMsg }],
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

  /** v3.0.16: /new — the session reset, the visible list resets with it. */
  const clearMessages = useCallback(() => {
    setState(prev => ({ ...prev, messages: [] }));
  }, []);

  return { ...state, sendMessage, cancel, hydrateMessages, clearMessages };
}

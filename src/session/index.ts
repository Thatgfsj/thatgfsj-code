/**
 * Session Manager - Manages conversation history with auto-compaction
 */

import type { ChatMessage } from '../types.js';
import { ContextCompactor } from './compactor.js';

/**
 * v2.2.4 (port from v2.1.0): patterns that, if found in an assistant
 * message, indicate the message is a truncated/aborted response that
 * should NOT be persisted into history. Without this filter, the next
 * turn's LLM sees the marker and starts echoing it back, creating a
 * self-reinforcing "[已中断]" hallucination loop.
 *
 * v2.2.6.1 tightening (smoke-test driven): the design here is a
 * two-tier check:
 *   1. STRONG markers — unambiguous pollution, always drop:
 *      - `[已中断]` bracketed (the model emits this exact form)
 *      - `[interrupted]` bracketed English equivalent
 *   2. WEAK markers — only drop if the message is also short (<200
 *      chars). Long messages mentioning "response truncated" are
 *      legitimate conversation (e.g. user complaints about past
 *      behavior), not pollution.
 *
 * Earlier drafts matched bare `已中断` substrings and "response
 * truncated" anywhere in the message — both were too greedy and
 * dropped legitimate Chinese/English conversation.
 */
const POLLUTION_STRONG: RegExp[] = [
  /\[已中断\]/,
  /\[interrupted\]/i,
];

const POLLUTION_WEAK: RegExp[] = [
  /^\s*[\*#>\-`]*\s*\[已中断\]/m,
  /^\s*[\*#>\-`]*\s*\[interrupted\]/im,
  /\bresponse (was )?(truncated|cut off|interrupted)\b/i,
  /\boutput (was )?(truncated|cut off|interrupted)\b/i,
];

function looksPolluted(content: string): boolean {
  if (!content) return false;
  if (POLLUTION_STRONG.some(p => p.test(content))) return true;
  // WEAK pattern gate:
  //   - Message must be short (model got cut off mid-stream, so it
  //     can't be long)
  //   - Message must NOT end with '?' (questions are user complaints
  //     about past behavior, not pollution)
  //   - Message must NOT contain "last time" / "earlier" / "before"
  //     (temporal references indicate user discussing past behavior)
  if (content.length >= 200) return false;
  if (/\?\s*$/.test(content.trim())) return false;
  if (/\b(last time|earlier|before|previously|yesterday)\b/i.test(content)) return false;
  if (POLLUTION_WEAK.some(p => p.test(content))) return true;
  return false;
}

export class SessionManager {
  private messages: ChatMessage[] = [];
  private sessionId: string;
  private createdAt: Date;
  private compactor: ContextCompactor;
  private maxMessages: number;
  /** v2.2.4: counter for messages dropped by the pollution filter. */
  private droppedCount: number = 0;
  /**
   * v3.0.0: callback invoked when the message count exceeds maxMessages.
   * Reasonix principle: do not mutate messages to compact; instead, signal
   * the TUI to suggest the user call /new (start a fresh session) so that
   * the upstream prompt cache keeps a stable prefix. NWT auto-logs every
   * meaningful event, so no history is lost — it just moves out of the
   * live cache window.
   */
  public onSuggestNewSession?: (info: { currentLength: number; max: number }) => void;

  constructor(maxMessages = 50, options?: { onSuggestNewSession?: SessionManager['onSuggestNewSession'] }) {
    this.maxMessages = maxMessages;
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.createdAt = new Date();
    this.compactor = new ContextCompactor({ maxMessages });
    this.onSuggestNewSession = options?.onSuggestNewSession;
  }

  addMessage(role: ChatMessage['role'], content: string, extras?: Partial<ChatMessage>): void {
    this.messages.push({ role, content, ...extras });
    this.autoCompact();
  }

  /**
   * v2.2.4 (port from v2.1.0): same as addMessage but returns false
   * (and skips the push) if the message content matches a known
   * truncation/abort pollution pattern. Use this for assistant
   * messages whose stream might have been aborted.
   */
  addMessageSafe(role: ChatMessage['role'], content: string, extras?: Partial<ChatMessage>): boolean {
    if (role === 'assistant' && looksPolluted(content)) {
      this.droppedCount++;
      return false;
    }
    this.addMessage(role, content, extras);
    return true;
  }

  /** v2.2.4: total messages dropped by addMessageSafe since session start. */
  getDroppedCount(): number {
    return this.droppedCount;
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  clear(): void {
    this.messages = [];
  }

  /**
   * v3.0.0: "auto-compact" is now a no-op on `messages`. We instead invoke
   * the registered `onSuggestNewSession` callback (if any) so the TUI can
   * surface a "context is getting long, consider /new" hint. This keeps
   * the messages array byte-stable across rounds, which is critical for
   * prompt-cache hit-rate: any reordering or summary insertion would
   * invalidate every cache breakpoint the upstream provider has set.
   *
   * Rationale (Reasonix-style): when context exceeds the model window or
   * the configured maxMessages threshold, the right action is to start a
   * NEW session, not to silently truncate or summarize. NWT auto-logs
   * every meaningful event, so the user does not lose context — it just
   * moves out of the live cache window. If the user wants a longer
   * session, they can bump maxMessages in `~/.thatgfsj/config.json`.
   *
   * The original "fake compact" logic (insert `[Earlier conversation...]`
   * summary) is preserved as `truncate()` for callers that explicitly
   * want to compact (e.g. /new command hard-reset).
   */
  private autoCompact(): void {
    if (this.messages.length <= this.maxMessages) return;

    // Notify the TUI. The default TUI behavior is to render a toast:
    //   ⚠️ 上下文超长（{currentLength}/{max}），建议调 /new 开新会话
    //            (NWT 已自动归档历史)
    try {
      this.onSuggestNewSession?.({
        currentLength: this.messages.length,
        max: this.maxMessages,
      });
    } catch {
      // Callback failure must not break the chat loop.
    }
    // Intentionally do NOT mutate this.messages. Prefix stability matters more.
  }

  truncate(maxMessages?: number): void {
    if (maxMessages) {
      this.maxMessages = maxMessages;
      this.compactor = new ContextCompactor({ maxMessages });
    }
    const { compacted } = this.compactor.compact(this.messages);
    this.messages = compacted;
  }

  getId(): string {
    return this.sessionId;
  }

  getInfo(): { id: string; messageCount: number; createdAt: Date } {
    return {
      id: this.sessionId,
      messageCount: this.messages.length,
      createdAt: this.createdAt,
    };
  }
}

export { ContextCompactor } from './compactor.js';
export type { CompactorConfig, CompressionResult } from './compactor.js';
export * from './message.js';

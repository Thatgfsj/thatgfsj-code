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
  // Common gates (apply to both tiers):
  //   - Length: model got cut off mid-stream → pollution is short.
  //     A long message with [已中断] in the middle is the model
  //     legitimately referencing the marker, not pollution.
  //   - Question: ends with '?' → user complaining about past behavior.
  //   - Temporal: contains "last time" / "earlier" / etc. → past tense.
  if (content.length >= 200) return false;
  if (/\?\s*$/.test(content.trim())) return false;
  if (/\b(last time|earlier|before|previously|yesterday)\b/i.test(content)) return false;
  // STRONG markers — bracketed truncation markers, unambiguous.
  if (POLLUTION_STRONG.some(p => p.test(content))) return true;
  // WEAK markers — bare "response truncated" phrases.
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

  constructor(maxMessages = 50) {
    this.maxMessages = maxMessages;
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.createdAt = new Date();
    this.compactor = new ContextCompactor({ maxMessages });
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
   * Auto-compact when messages exceed max.
   * Keeps system messages + recent half. One summary replaces the rest.
   */
  private autoCompact(): void {
    if (this.messages.length <= this.maxMessages) return;

    const systemMsgs = this.messages.filter(m => m.role === 'system');
    const others = this.messages.filter(m => m.role !== 'system');
    const keepCount = Math.floor(this.maxMessages * 0.5);
    const recent = others.slice(-keepCount);
    const removed = others.length - keepCount;

    if (removed <= 0) return;

    // Remove old summaries before adding new one
    const cleanSystem = systemMsgs.filter(m => !m.content.startsWith('[Earlier conversation'));
    const summary: ChatMessage = {
      role: 'system',
      content: `[Earlier conversation: ${removed} messages compacted to save context]`,
    };
    this.messages = [...cleanSystem, summary, ...recent];
  }

  truncate(maxMessages?: number): void {
    if (maxMessages) {
      // v2.2.7 edge fix: preserveRecent must be <= maxMessages - 1,
      // otherwise the compactor's "always keep recent N" branch
      // overrides the trim and no messages actually get dropped.
      // Set preserveRecent to maxMessages-1 so anything beyond the
      // last maxMessages-1 user/assistant msgs gets summarized.
      this.maxMessages = maxMessages;
      this.compactor = new ContextCompactor({
        maxMessages,
        preserveRecent: Math.max(1, maxMessages - 1),
      });
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

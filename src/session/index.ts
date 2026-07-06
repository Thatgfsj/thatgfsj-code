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
 * Kept conservative: only matches explicit truncation markers the model
 * itself uses, NOT general mentions in normal conversation.
 */
const POLLUTION_PATTERNS: RegExp[] = [
  /^\s*\[已中断\]/m,                 // marker at line start
  /\u5df2\u4e2d\u65ad[^\n]{0,40}/,   // '已中断' followed by short truncation context
  /response (was )?truncated/i,
  /output (was )?cut off/i,
  /\[interrupted\]/i,
];

function looksPolluted(content: string): boolean {
  if (!content) return false;
  return POLLUTION_PATTERNS.some(p => p.test(content));
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

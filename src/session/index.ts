/**
 * Session Manager - Manages conversation history with auto-compaction
 */

import type { ChatMessage } from '../types.js';
import { ContextCompactor } from './compactor.js';

export class SessionManager {
  private messages: ChatMessage[] = [];
  private sessionId: string;
  private createdAt: Date;
  private compactor: ContextCompactor;
  private maxMessages: number;

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

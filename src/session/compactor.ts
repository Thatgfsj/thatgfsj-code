/**
 * Context Compactor - Progressive compression for conversation history
 * Migrated from old src/core/context-compactor.ts
 *
 * Strategy:
 * 1. Within limit: no compression
 * 2. Beyond limit: keep system + recent N turns + summarize middle
 */

import type { ChatMessage } from '../types.js';

export interface CompactorConfig {
  /** Max messages before compression kicks in */
  maxMessages?: number;
  /** How many recent turns to always preserve */
  preserveRecent?: number;
}

export interface CompressionResult {
  originalCount: number;
  compactedCount: number;
  removedCount: number;
}

export class ContextCompactor {
  private maxMessages: number;
  private preserveRecent: number;

  constructor(config: CompactorConfig = {}) {
    this.maxMessages = config.maxMessages ?? 50;
    this.preserveRecent = config.preserveRecent ?? 10;
  }

  /**
   * Compact messages if needed
   */
  compact(messages: ChatMessage[]): { compacted: ChatMessage[]; result: CompressionResult } {
    if (messages.length <= this.maxMessages) {
      return {
        compacted: messages,
        result: { originalCount: messages.length, compactedCount: messages.length, removedCount: 0 },
      };
    }

    const systemMsg = messages.find(m => m.role === 'system');
    const others = messages.filter(m => m.role !== 'system');

    if (others.length <= this.preserveRecent) {
      return {
        compacted: messages,
        result: { originalCount: messages.length, compactedCount: messages.length, removedCount: 0 },
      };
    }

    // Keep recent N turns
    const recent = others.slice(-this.preserveRecent);

    // Summarize the middle portion
    const middle = others.slice(0, -this.preserveRecent);
    const summary: ChatMessage = {
      role: 'system',
      content: `[Earlier conversation summary: ${middle.length} messages covering ${this.extractTopics(middle)}]`,
    };

    const compacted = systemMsg
      ? [systemMsg, summary, ...recent]
      : [summary, ...recent];

    return {
      compacted,
      result: {
        originalCount: messages.length,
        compactedCount: compacted.length,
        removedCount: messages.length - compacted.length,
      },
    };
  }

  /**
   * Auto-compact if messages exceed limit
   */
  autoCompact(messages: ChatMessage[]): { compacted: ChatMessage[]; result: CompressionResult } {
    return this.compact(messages);
  }

  /**
   * Estimate token count (rough: ~4 chars per token)
   */
  estimateTokens(messages: ChatMessage[]): number {
    return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4) + 10, 0);
  }

  /**
   * Extract topic summary from messages
   */
  private extractTopics(msgs: ChatMessage[]): string {
    const topics = msgs
      .filter(m => m.role === 'user')
      .map(m => m.content.slice(0, 30))
      .slice(0, 3);
    return topics.join(', ') || 'various topics';
  }
}

/**
 * Context Compactor - Progressive compression for conversation history
 *
 * v3.0.5: compression now respects TOOL-CALL ATOMICITY. OpenAI and
 * Anthropic both reject a request where an assistant message carrying
 * tool_calls is not immediately followed by its tool result messages (and
 * vice versa). The previous implementation sliced by raw message count and
 * happily cut right through a call/result pair, producing 400s from that
 * point on. Messages are now grouped first — an assistant message with
 * tool_calls plus all of its following tool messages form one atomic
 * group — and only whole groups are summarized away.
 */

import type { ChatMessage } from '../types.js';

export interface CompactorConfig {
  /** Max messages before compression kicks in */
  maxMessages?: number;
  /** Approximate message budget to preserve for recent context */
  preserveRecent?: number;
}

export interface CompressionResult {
  originalCount: number;
  compactedCount: number;
  removedCount: number;
}

/** A group of messages that must be kept together (or dropped together). */
export interface MessageGroup {
  messages: ChatMessage[];
}

/**
 * Split non-system messages into atomic groups.
 *
 * Rules:
 * - a `tool` message always joins the group before it (its assistant
 *   tool_calls carrier)
 * - an assistant message with tool_calls starts a new group (its results
 *   will follow inside the same group)
 * - a user or plain assistant message starts a new group
 */
export function splitIntoGroups(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];

  for (const m of messages) {
    if (m.role === 'tool') {
      if (groups.length > 0) {
        groups[groups.length - 1].messages.push(m);
      } else {
        // Orphaned tool result (malformed history) — keep it isolated so we
        // don't attach it to an unrelated pair.
        groups.push({ messages: [m] });
      }
      continue;
    }
    groups.push({ messages: [m] });
  }

  return groups;
}

export class ContextCompactor {
  private maxMessages: number;
  private preserveRecent: number;

  constructor(config: CompactorConfig = {}) {
    this.maxMessages = config.maxMessages ?? 50;
    this.preserveRecent = config.preserveRecent ?? 10;
  }

  /**
   * Compact messages if needed. Returns the input unchanged when under the
   * limit or when nothing can be removed.
   */
  compact(messages: ChatMessage[]): { compacted: ChatMessage[]; result: CompressionResult } {
    if (messages.length <= this.maxMessages) {
      return {
        compacted: messages,
        result: { originalCount: messages.length, compactedCount: messages.length, removedCount: 0 },
      };
    }

    const systemMsgs = messages.filter(m => m.role === 'system');
    const others = messages.filter(m => m.role !== 'system');
    const groups = splitIntoGroups(others);

    if (groups.length <= 1) {
      // Nothing compressible — a single group must stay atomic.
      return {
        compacted: messages,
        result: { originalCount: messages.length, compactedCount: messages.length, removedCount: 0 },
      };
    }

    // Pick trailing groups whose combined size fits the recent budget
    // (always keep at least one group).
    const recent: MessageGroup[] = [];
    let recentSize = 0;
    for (let i = groups.length - 1; i >= 0; i--) {
      const size = groups[i].messages.length;
      if (recentSize + size > this.preserveRecent && recent.length > 0) break;
      recent.unshift(groups[i]);
      recentSize += size;
    }

    const middle = groups.slice(0, groups.length - recent.length);
    if (middle.length === 0) {
      return {
        compacted: messages,
        result: { originalCount: messages.length, compactedCount: messages.length, removedCount: 0 },
      };
    }

    const summary: ChatMessage = {
      role: 'system',
      content: `[Earlier conversation summary: ${middle.reduce((n, g) => n + g.messages.length, 0)} messages covering ${this.extractTopics(middle)}]`,
    };

    const recentMsgs = recent.flatMap(g => g.messages);
    const compacted = [...systemMsgs, summary, ...recentMsgs];

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
    const size = (m: ChatMessage) =>
      (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length);
    return messages.reduce((sum, m) => sum + Math.ceil(size(m) / 4) + 10, 0);
  }

  /**
   * Extract a short topic list from the middle groups (their user prompts).
   */
  private extractTopics(groups: MessageGroup[]): string {
    const topics: string[] = [];
    for (const g of groups) {
      for (const m of g.messages) {
        if (m.role === 'user' && typeof m.content === 'string') {
          topics.push(m.content.slice(0, 60).replace(/\s+/g, ' '));
          if (topics.length >= 5) return topics.join(' | ');
        }
      }
    }
    return topics.join(' | ') || 'various topics';
  }
}

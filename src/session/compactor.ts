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
   *
   * v3.6.0 (context-field-report P0): `tokenPressure` bypasses the message-
   * count gate. The gate used to make token-triggered compaction DEAD CODE
   * — a 50-message window with 8k-capped tool outputs can never reach the
   * 108k-token trigger line, and when token pressure DID arrive (small-
   * window models, Chinese-heavy text), compact() refused and the raw
   * request sailed into a provider 400. Token pressure now compacts even
   * under the message limit.
   */
  compact(
    messages: ChatMessage[],
    opts?: { tokenPressure?: boolean },
  ): { compacted: ChatMessage[]; result: CompressionResult } {
    if (!opts?.tokenPressure && messages.length <= this.maxMessages) {
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
      content: this.buildHandoffSummary(middle),
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

  /**
   * v3.0.20: handoff-style checkpoint (Codex compact parity). Instead of a
   * bare "[N messages about X]" line, give the next context window the three
   * things it needs to continue seamlessly: the user's earlier goals, the
   * volume/kinds of tool activity, and an explicit carry-on note. Still
   * purely mechanical — an LLM-summarized handoff is a future upgrade — but
   * it preserves intent instead of just topic keywords.
   */
  private buildHandoffSummary(groups: MessageGroup[]): string {
    let toolCalls = 0;
    const toolNames = new Map<string, number>();
    for (const g of groups) {
      for (const m of g.messages) {
        if (m.role === 'tool') toolCalls++;
        if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
          for (const tc of m.tool_calls) {
            toolCalls++;
            toolNames.set(tc.function.name, (toolNames.get(tc.function.name) || 0) + 1);
          }
        }
      }
    }
    const goalLines: string[] = [];
    for (const g of groups) {
      for (const m of g.messages) {
        if (m.role === 'user' && typeof m.content === 'string' && m.content.trim() && !m.content.startsWith('[')) {
          goalLines.push(`  - ${m.content.trim().slice(0, 120).replace(/\s+/g, ' ')}`);
          if (goalLines.length >= 5) break;
        }
      }
      if (goalLines.length >= 5) break;
    }
    const toolLine = toolCalls > 0
      ? `\nTool activity in the compacted part: ${toolCalls} call(s)` +
        (toolNames.size > 0 ? ` (${[...toolNames.entries()].map(([n, c]) => `${n}×${c}`).join(', ')})` : '')
      : '';
    return [
      `[CONTEXT CHECKPOINT — 早期对话已压缩以释放上下文窗口]`,
      `接手须知：以下是最早被压缩的 ${groups.reduce((n, g) => n + g.messages.length, 0)} 条消息的交接摘要。`,
      goalLines.length ? `用户在此前的目标/请求：\n${goalLines.join('\n')}` : '（此段无明确的用户文本请求）',
      `所涉主题：${this.extractTopics(groups)}`,
      toolLine +
      `\n继续当前任务：如需被压缩的早期细节，请基于最近的上下文继续，必要时向用户确认，避免重复已完成的工作。`,
    ].join('\n');
  }
}

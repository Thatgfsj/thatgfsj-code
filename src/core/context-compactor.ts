/**
 * S05: Context Compactor - 3-tier progressive compression strategy
 * 
 * Tier 1: Truncation   - Remove oldest messages beyond hard limit
 * Tier 2: Summarize    - Replace old message ranges with summary
 * Tier 3: Selective    - Keep only recent N turns around tool executions
 * 
 * Core insight: Context window is finite. Three-tier strategy enables "infinite" work.
 */

import { ChatMessage } from './types.js';

export interface CompactorConfig {
  /** Hard limit: messages beyond this get removed first */
  hardLimit?: number;
  /** Soft limit: messages beyond this get summarized */
  softLimit?: number;
  /** How many recent turns to always preserve */
  preserveRecent?: number;
  /** Enable summarization (requires AI API) */
  enableSummarize?: boolean;
}

export interface CompressionResult {
  originalCount: number;
  compactedCount: number;
  removedCount: number;
  method: 'none' | 'truncation' | 'summarize' | 'selective';
}

/**
 * S05: Context Compactor
 */
export class ContextCompactor {
  private config: CompactorConfig;
  private totalTokensUsed = 0;

  constructor(config: CompactorConfig = {}) {
    this.config = {
      hardLimit: 50,
      softLimit: 30,
      preserveRecent: 10,
      enableSummarize: false,
      ...config
    };
  }

  /**
   * S05: Compact messages using 3-tier strategy
   * Called at the end of each agent turn
   */
  compact(messages: ChatMessage[]): { compacted: ChatMessage[]; result: CompressionResult } {
    const count = messages.length;

    // Tier 1: Within hard limit — no compression
    if (count <= (this.config.hardLimit || 50)) {
      return {
        compacted: messages,
        result: { originalCount: count, compactedCount: count, removedCount: 0, method: 'none' }
      };
    }

    // Tier 2: Beyond soft limit — summarize middle messages
    if (count > (this.config.softLimit || 30)) {
      return this.summarizeStrategy(messages);
    }

    // Tier 3: Between soft and hard — selective preservation
    return this.selectiveStrategy(messages);
  }

  // Tier 1: Simple truncation
  private truncate(messages: ChatMessage[], maxMessages: number): ChatMessage[] {
    const systemMsg = messages.find(m => m.role === 'system');
    const others = messages.filter(m => m.role !== 'system');
    const toRemove = others.length - maxMessages;

    if (toRemove <= 0 || others.length === 0) {
      return messages;
    }

    // Remove oldest non-system messages
    const keptOthers = others.slice(toRemove);
    return systemMsg ? [systemMsg, ...keptOthers] : keptOthers;
  }

  // Tier 2: Summarize middle messages (stub — needs AI for real summarization)
  private summarizeStrategy(messages: ChatMessage[]): { compacted: ChatMessage[]; result: CompressionResult } {
    const preserved = this.config.preserveRecent || 10;
    const systemMsg = messages.find(m => m.role === 'system');
    const others = messages.filter(m => m.role !== 'system');

    if (others.length <= preserved) {
      return {
        compacted: messages,
        result: { originalCount: messages.length, compactedCount: messages.length, removedCount: 0, method: 'none' }
      };
    }

    // Keep recent N turns
    const recent = others.slice(-preserved);

    // Summarize the middle (this is a placeholder — real impl would call AI)
    const summaryMsg: ChatMessage = {
      role: 'system',
      content: '[S05: ' + (others.length - preserved) + ' earlier messages summarized — ' +
        'conversation had ' + (others.length - preserved) + ' exchanges covering ' +
        this.summarizeTopic(others.slice(0, -preserved)) + ']'
    };

    const compacted = systemMsg
      ? [systemMsg, summaryMsg, ...recent]
      : [summaryMsg, ...recent];

    return {
      compacted,
      result: {
        originalCount: messages.length,
        compactedCount: compacted.length,
        removedCount: messages.length - compacted.length,
        method: 'summarize'
      }
    };
  }

  // Extract simple topic from message content
  private summarizeTopic(msgs: ChatMessage[]): string {
    const texts = msgs
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .slice(0, 3)
      .join(' ')
      .substring(0, 50);
    return texts || 'various topics';
  }

  // Tier 3: Selective — keep turns around tool executions
  private selectiveStrategy(messages: ChatMessage[]): { compacted: ChatMessage[]; result: CompressionResult } {
    const systemMsg = messages.find(m => m.role === 'system');
    const others = messages.filter(m => m.role !== 'system');
    const max = this.config.softLimit || 30;

    if (others.length <= max) {
      return {
        compacted: messages,
        result: { originalCount: messages.length, compactedCount: messages.length, removedCount: 0, method: 'none' }
      };
    }

    // Find indices of tool-related messages
    const toolIndices = new Set<number>();
    others.forEach((m, i) => {
      if (m.tool_calls || m.role === 'tool' || m.role === 'assistant') {
        toolIndices.add(i);
      }
    });

    // Also add indices around tool messages
    for (const idx of toolIndices) {
      for (let offset = -2; offset <= 2; offset++) {
        toolIndices.add(idx + offset);
      }
    }

    // Keep system message + messages near tool executions + recent messages
    const recentCount = Math.floor(max * 0.3); // 30% recent
    const toolCount = max - recentCount;

    const recent = others.slice(-recentCount);
    const toolMsgs: ChatMessage[] = [];
    for (const idx of [...toolIndices].sort((a, b) => a - b)) {
      if (toolMsgs.length >= toolCount) break;
      if (idx >= 0 && idx < others.length - recentCount) {
        toolMsgs.push(others[idx]);
      }
    }

    const compacted = systemMsg
      ? [systemMsg, ...toolMsgs, ...recent]
      : [...toolMsgs, ...recent];

    // Deduplicate while preserving order
    const seen = new Set<string>();
    const deduped = compacted.filter(m => {
      const key = m.role + m.content.substring(0, 30);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      compacted: deduped,
      result: {
        originalCount: messages.length,
        compactedCount: deduped.length,
        removedCount: messages.length - deduped.length,
        method: 'selective'
      }
    };
  }

  // S05: Check if context is approaching limit
  isNearLimit(messages: ChatMessage[], limit: number = 150000): boolean {
    // Rough estimate: 1 message ~= 200 tokens on average
    const estimatedTokens = messages.length * 200;
    return estimatedTokens > limit * 0.8; // 80% of limit
  }

  // S05: Get estimated token count
  estimateTokens(messages: ChatMessage[]): number {
    return messages.reduce((sum, m) => {
      // Rough: content chars / 4 tokens
      return sum + Math.ceil(m.content.length / 4) + 10; // +10 for role/overhead
    }, 0);
  }

  // S05: Auto-compact if needed (called from AIEngine or SessionManager)
  autoCompact(messages: ChatMessage[]): { compacted: ChatMessage[]; result: CompressionResult } {
    if (this.isNearLimit(messages)) {
      return this.compact(messages);
    }
    return {
      compacted: messages,
      result: { originalCount: messages.length, compactedCount: messages.length, removedCount: 0, method: 'none' }
    };
  }
}

// ==================== SessionManager Integration ====================

export function integrateWithSessionManager(SessionManagerClass: any) {
  const originalTruncate = SessionManagerClass.prototype.truncate;
  
  SessionManagerClass.prototype.truncate = function(maxMessages: number, forceCompact = false) {
    if (forceCompact) {
      const compactor = new ContextCompactor({ hardLimit: maxMessages });
      const { compacted, result } = compactor.autoCompact(this.messages);
      if (result.method !== 'none') {
        this.messages = compacted;
        return result;
      }
    }
    return originalTruncate.call(this, maxMessages);
  };
}

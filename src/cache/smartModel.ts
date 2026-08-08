/**
 * Smart-model routing + auto TTL selection (P3 of the Reasonix plan,
 * v3.0.3 onwards).
 *
 * Idea: classify the conversation as "short" / "medium" / "long" and
 * route accordingly. Two levers:
 *
 *   1. Model downgrade
 *      Short follow-ups ("yes", "thanks") → mini model
 *      Tool-heavy turns → main model
 *
 *   2. Cache TTL
 *      Short conversations            → 5m  (cheap write, expires fast)
 *      Long conversations (>15 turns) → 1h  (cache hits pay back the
 *                                            expensive write each round)
 *
 * Why TTL is decided per-ROUND but CHANGES per-CONVERSATION:
 *   The Anthropic cache_control marker is part of the request body.
 *   Changing the TTL between rounds would push the wire bytes to a
 *   different Anthropic cache bucket, blowing the cache on every round
 *   and *costing* more in cache_creation_input_tokens than what we save.
 *
 *   So we compute the TTL once per conversation (lazily, on the first
 *   round) and never change it. Subsequent rounds get the same TTL,
 *   which keeps the cache prefix stable and lets Anthropic match it.
 *
 *   The "smart" part is that we look at the FULL conversation so far,
 *   not just the last input. A 16-turn conversation that started with a
 *   short prompt but grew into a long refactor still gets 1h.
 *
 * Trade-off: the first round is evaluated with 0 history, so it
 * defaults to 5m. If the conversation then grows long, future rounds
 * still use 5m for the system-token cache (because we already wrote
 * it with 5m). The tool definition cache gets the same TTL.
 */

import type { ChatMessage } from '../types.js';

export interface SmartModelDecision {
  /** Should we route this turn to a cheaper model? */
  downgrade: boolean;
  /** Why we made this call — useful for `/cache` debug output. */
  reason: string;
}

export interface SmartTTLDecision {
  ttl: '5m' | '1h';
  reason: string;
  /** Computed per-conversation. Once we pick a TTL, we keep it. */
  isFirstDecision: boolean;
}

/**
 * Heuristic: downgrade when
 *   1. The latest user message is short (< 200 chars), AND
 *   2. The last 3 messages contain no assistant tool_calls.
 *
 * This covers greetings, one-line questions, and simple follow-ups
 * ("thanks", "ok", "explain this one line") while routing anything
 * that triggered a tool to the main model.
 */
export function shouldDowngrade(messages: ChatMessage[], lastUserInput: string): SmartModelDecision {
  if (lastUserInput.length > 200) {
    return { downgrade: false, reason: 'prompt-too-long' };
  }
  const recent = messages.slice(-3);
  const hasRecentToolCalls = recent.some(m => m.tool_calls && m.tool_calls.length > 0);
  if (hasRecentToolCalls) {
    return { downgrade: false, reason: 'recent-tool-call' };
  }
  return { downgrade: true, reason: 'short-no-tools' };
}

/**
 * Total character count of all message content. Used as a cheap
 * proxy for "is this conversation long enough to justify 1h TTL?"
 * (Anthropic charges cache_creation at 1.25x normal input, so we
 * need to be sure the conversation will hit cache ~10+ times to
 * break even on 1h vs 5m.)
 */
export function totalConversationChars(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      total += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const blk of m.content) {
        if (blk.type === 'text') total += (blk as any).text.length;
      }
    }
  }
  return total;
}

/**
 * Decide the cache TTL for the current round.
 *
 * Inputs:
 *   - messages: full conversation so far (system + user + assistant + tool)
 *   - previousTTL: TTL chosen in a prior round (null on round 0)
 *
 * Decision matrix:
 *   - round 0 + any input length → 5m (default; user can override via init)
 *   - round 1-14 + total chars < 50k → 5m (short sessions, 5m is enough)
 *   - round 15+ OR total chars > 50k → 1h (long sessions, 1h amortizes the write)
 *
 * Stability rule: once a TTL is chosen, it is reused for every
 * subsequent round in the same session. Changing TTL between rounds
 * would invalidate the Anthropic cache prefix and cost more than it
 * saves.
 *
 * The `isFirstDecision` flag tells the caller whether to apply the
 * decision (first round) or reuse the previous one (later rounds).
 */
export function decideTTL(
  messages: ChatMessage[],
  previousTTL: '5m' | '1h' | null,
): SmartTTLDecision {
  if (previousTTL) {
    return { ttl: previousTTL, reason: 'reused-from-previous-round', isFirstDecision: false };
  }

  const turnCount = messages.filter(m => m.role === 'user' || m.role === 'assistant').length;
  const totalChars = totalConversationChars(messages);

  // Round 0: empty / first input. Default to 5m.
  if (turnCount === 0) {
    return { ttl: '5m', reason: 'first-round-default', isFirstDecision: true };
  }

  // Multi-turn but small conversation → 5m
  if (turnCount < 15 && totalChars < 50_000) {
    return { ttl: '5m', reason: `short-session-${turnCount}-turns`, isFirstDecision: true };
  }

  // Long conversations → 1h
  if (turnCount >= 15) {
    return { ttl: '1h', reason: `long-session-${turnCount}-turns`, isFirstDecision: true };
  }
  if (totalChars >= 50_000) {
    return { ttl: '1h', reason: `long-context-${totalChars}-chars`, isFirstDecision: true };
  }

  return { ttl: '5m', reason: 'fallback', isFirstDecision: true };
}

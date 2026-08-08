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
 *      v3.0.4: default to 1h (long-task TTL). We cannot predict task
 *      length at round 0, so we choose the TTL that cannot expire
 *      mid-task. 5m is opt-in only (user pins it via /ttl 5m or the
 *      init wizard).
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
 * Trade-off: 1h write costs 2x input price (vs 1.25x for 5m), but
 * reads are the same 0.1x. A long task hitting cache 2-3 times pays
 * back the extra write cost; a short task pays it once and moves on.
 * That is strictly better than guessing 5m and having the cache expire
 * mid-task.
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
 * v3.0.4: The previous implementation tried to *predict* the task length
 * from the conversation so far (short sessions → 5m, long → 1h). That
 * was wrong: at the moment the decision is made (first round), the task
 * hasn't started yet — there is no way to know whether it will be a
 * 30-second question or a 3-hour refactor. Predicting 5m for a task
 * that turns out to be long means the cache expires mid-task (5-minute
 * TTL counts from the last HIT, and agent work often has >5m gaps while
 * tools run / user reads output), so every round after the gap re-writes
 * the whole prefix at full price.
 *
 * Correct rule: DEFAULT TO THE LONG TTL (1h) and don't guess.
 *   - 1h costs 2x input price to WRITE (vs 1.25x for 5m), but reads are
 *     the same 0.1x for both.
 *   - A long task that hits cache even 2-3 times pays back the extra
 *     write cost. A short task only pays the extra write once.
 *   - Users who are SURE the session is short can pin 5m via
 *     /ttl 5m or the init wizard — the default stays 1h.
 *
 * Stability rule (unchanged): once a TTL is chosen, it is reused for
 * every subsequent round in the same session. Changing TTL between
 * rounds would invalidate the Anthropic cache prefix and cost more
 * than it saves.
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
  // Default: long-task TTL. We cannot know the task length upfront, so
  // we pick the TTL that cannot expire mid-task. 5m is only used when
  // the user explicitly pins it.
  return { ttl: '1h', reason: 'default-long-task', isFirstDecision: true };
}

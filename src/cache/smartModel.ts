/**
 * Smart-model routing (P3 of the Reasonix plan).
 *
 * Idea: classify the user's input as "simple" or "complex" and route
 * simple queries to a cheaper / faster model while keeping the main model
 * for complex work. The classification is intentionally trivial — prompt
 * length + presence of recent tool calls — because the cost of a
 * misclassification (a slightly worse answer on a simple query) is much
 * lower than the cost of running a frontier model on every greeting.
 *
 * Trade-off: each routing decision adds one model swap (different
 * `model` field on the wire). If the cache prefix is keyed on the model
 * string, the cache miss rate can spike on every simple query. To keep
 * the prefix stable, callers should pass a *family* (e.g. "anthropic" or
 * "deepseek") rather than a specific model name when forwarding the
 * prompt to the downstream provider — that's outside the scope of this
 * hook; this module only answers the question "should I downgrade?".
 *
 * v3.0.0: shipped as a stub. Real decision logic is conservative
 * (downgrade only when prompt is short AND no recent tool activity).
 * Future iterations can add heuristic or classifier-based routing.
 */

import type { ChatMessage } from '../types.js';

export interface SmartModelDecision {
  /** Should we route this turn to a cheaper model? */
  downgrade: boolean;
  /** Why we made this call — useful for `/cache` debug output. */
  reason: string;
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

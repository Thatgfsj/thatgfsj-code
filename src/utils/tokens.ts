/**
 * v3.0.13: token estimation helpers.
 *
 * No tokenizer dependency (tiktoken is heavy); we use a CJK-aware
 * heuristic: CJK characters ≈ 1 token each, everything else ≈ 4 chars per
 * token. Good enough for per-message display and auto-compact thresholds
 * (which are driven by the provider's REAL prompt_tokens usage anyway).
 */

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const rest = text.length - cjk;
  return Math.max(1, Math.ceil(cjk + rest / 4));
}

/** Auto-compact threshold check: prompt tokens ≥ 85% of the context window. */
export function shouldAutoCompact(promptTokens: number, contextWindow: number, threshold = 0.85): boolean {
  if (!promptTokens || promptTokens <= 0 || !contextWindow || contextWindow <= 0) return false;
  return promptTokens / contextWindow >= threshold;
}

/** Format a token count for display: 950 → "950", 11200 → "11.2k". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 1000000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return (n / 1000000).toFixed(2).replace(/\.00$/, '').replace(/0$/, '') + 'M';
}

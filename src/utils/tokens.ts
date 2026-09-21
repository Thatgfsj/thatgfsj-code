/**
 * v3.0.13: token estimation helpers.
 *
 * v3.6.0 recalibration (field-measured against the wire): CJK text runs
 * ≈0.6 tokens/char on Qwen tokenizers and ~0.7-1.0 elsewhere, so the old
 * flat 1.0/char OVERESTIMATED Chinese by ~1.66x; English/JSON runs ≈3.0
 * chars/token, so the old 4.0 UNDERESTIMATED by ~1.3x. We now sit just
 * ABOVE both measurements (0.75 CJK, 3.4 chars/token) — estimating is for
 * window-pressure decisions, and erring slightly high is the safe side.
 */

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const rest = text.length - cjk;
  return Math.max(1, Math.ceil(cjk * 0.75 + rest / 3.4));
}

/** Format a token count for display: 950 → "950", 11200 → "11.2k". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 1000000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return (n / 1000000).toFixed(2).replace(/\.00$/, '').replace(/0$/, '') + 'M';
}

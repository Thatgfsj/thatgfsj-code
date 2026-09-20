/**
 * Extract the human-readable message from a provider error body that our
 * HTTP layer folded into the error text ("API error 429: {json}").
 * The raw JSON is noise for a terminal user — zhipu, for instance, returns
 * `1113 余额不足或无可用资源包` on 429, which used to be swallowed by the
 * generic "Rate limit exceeded" mapping.
 */
export function extractUpstreamMessage(raw: string): string {
  // provider JSON shape: {"error":{"code":"1113","message":"…"}}
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { error?: { message?: unknown }; message?: unknown };
      const m = parsed.error?.message ?? parsed.message;
      if (typeof m === 'string' && m.trim()) return m.trim();
    } catch { /* not JSON after all — fall through */ }
  }
  const quoted = raw.match(/"message"\s*:\s*"([^"]+)"/);
  if (quoted) return quoted[1];
  return '';
}

/**
 * Deterministic JSON serializer.
 *
 * JSON.stringify in V8 iterates keys in insertion order, which means objects
 * built with literal `{a, b, c}` are stable, but anything built via spread,
 * Object.fromEntries, or merged maps can produce different byte sequences
 * between requests. That byte-sequence instability is fatal for prompt-cache
 * hit-rate: a single reordered key invalidates the cache fingerprint.
 *
 * stableStringify sorts object keys lexicographically before recursing, so
 * any pair of structurally equal objects produces identical JSON text.
 *
 * Performance note: O(n log n) on key counts per object. For typical request
 * bodies (<200 KB) the overhead is negligible (<5 ms). The main hot path is
 * the tool/parameters tree which is small and stable in practice.
 *
 * Reference: Reasonix-style "stableStringify" requirement for prefix-cache
 * byte-level stability (see DeepSeek Reasonix, Section 3).
 */
export function stableStringify(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'null'; // OpenAI wire format does not carry undefined
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number') return Number.isFinite(value as number) ? String(value) : 'null';
  if (t === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stringify(v)).join(',') + ']';
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue; // omit undefined to match OpenAI/Anthropic convention
      parts.push(JSON.stringify(k) + ':' + stringify(v));
    }
    return '{' + parts.join(',') + '}';
  }
  // functions / symbols / bigints: drop
  return 'null';
}

/**
 * Cache fingerprints — small, stable hashes used to detect when the
 * "cacheable prefix" of an LLM request changes between rounds.
 *
 * Why this exists:
 *   Anthropic prompt cache and DeepSeek automatic prefix cache both break
 *   when the request body changes upstream of the cache breakpoint. To
 *   debug "why is my hit-rate 0%", we want a quick fingerprint of the
 *   things that *should* be cacheable (tools + system prefix) so we can
 *   log it on every request and compare across rounds.
 *
 *   The fingerprint itself is NOT used to decide anything (the upstream
 *   provider does the actual cache lookup). It's purely a debug /
 *   observability tool — same role as `reasoning_content` in the message
 *   schema: captured for transparency, not for control flow.
 *
 * Implementation:
 *   - Uses stableStringify (sibling module) so logically equal objects
 *     always produce the same JSON.
 *   - Hashes with sha256 (Node built-in `crypto`), truncated to 16 chars.
 *     16 hex chars = 64 bits, which is plenty for collision-resistance
 *     across a single user's session.
 */

import { createHash } from 'crypto';
import type { Tool } from '../tools/types.js';
import type { SystemSegment } from '../prompts/index.js';

/**
 * Hash a stable JSON representation of `value` and return a 16-char hex prefix.
 * Recursively normalizes object keys (sorted) so insertion order does not
 * affect the output.
 */
export function fingerprint(value: unknown): string {
  // stableStringify is imported lazily to avoid a circular dep — fingerprint
  // is consumed by both providers (which sit above utils/) and the cache
  // stats store (which sits next to fingerprint). Top-level import works
  // because utils has no other consumers besides fingerprint, so we just
  // import statically.
  return createHash('sha256')
    .update(stableStringifyLocal(value))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Compute a fingerprint of the registered tool schemas.
 *
 * We deliberately pick only `name`, `description`, and `inputSchema` — the
 * three fields that matter for the upstream prompt cache. Other Tool
 * metadata (version strings, descriptions of internal handlers, etc) is
 * ignored because it never reaches the wire.
 */
export function fingerprintTools(tools: Tool[]): string {
  const minimal = tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  return fingerprint({ tools: minimal });
}

/**
 * Compute a fingerprint of the system prompt's *immutable* portion.
 *
 * Volatile segments (NWT history, current time) are deliberately excluded
 * because they change between rounds and would defeat the fingerprint's
 * purpose as a "did the cacheable prefix change?" signal.
 */
export function fingerprintSystemPrefix(segments: SystemSegment[]): string {
  const immutable = segments.filter(s => !s.volatile);
  return fingerprint({ system: immutable.map(s => ({ name: s.name, content: s.content })) });
}

// -- Local copy of stableStringify to avoid a circular dep. This must stay
//    byte-for-byte identical to src/utils/stableStringify.ts. If you change
//    one, change both.

function stableStringifyLocal(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number') return Number.isFinite(value as number) ? String(value) : 'null';
  if (t === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringifyLocal(v)).join(',') + ']';
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue;
      parts.push(JSON.stringify(k) + ':' + stableStringifyLocal(v));
    }
    return '{' + parts.join(',') + '}';
  }
  return 'null';
}

/**
 * v3.4.2: model switch history with provider ownership.
 *
 * The old models.json was a bare string[] written by raw fs calls from
 * app.tsx. Strings carry no provider, so /model mixed every provider's
 * models into one list and picking a foreign id silently sent the request
 * to the CURRENT provider's endpoint (guaranteed 404/401). Entries are now
 * { id, provider }; legacy string entries are migrated with the CURRENT
 * provider as best-guess owner. Writes are atomic, reads are sanitized.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { ProviderName } from './types.js';

export interface ModelHistoryEntry {
  id: string;
  /** 'unknown' = legacy string entry — shown nowhere (the old untagged
   *  list mixing every provider was the bug this module replaces). */
  provider: ProviderName | 'unknown';
}

export function modelHistoryPath(): string {
  return join(homedir(), '.thatgfsj', 'models.json');
}

export function loadModelHistory(): ModelHistoryEntry[] {
  const p = modelHistoryPath();
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    if (!Array.isArray(raw)) return [];
    const out: ModelHistoryEntry[] = [];
    for (const e of raw) {
      if (typeof e === 'string' && e.trim()) {
        out.push({ id: e, provider: 'unknown' });
      } else if (e && typeof e === 'object' && typeof (e as ModelHistoryEntry).id === 'string') {
        out.push({ id: (e as ModelHistoryEntry).id, provider: (e as ModelHistoryEntry).provider || 'unknown' });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** History entries belonging to `provider`, most recent first, current model kept. */
export function historyForProvider(provider: ProviderName | undefined, currentModel?: string): ModelHistoryEntry[] {
  const all = loadModelHistory();
  const seen = new Set<string>();
  const out: ModelHistoryEntry[] = [];
  for (const e of [...all].reverse()) {
    if (provider && e.provider !== provider) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  if (currentModel && !seen.has(currentModel)) {
    out.unshift({ id: currentModel, provider: provider || 'unknown' });
  }
  return out;
}

/** Record a model switch. Atomic write; never throws. */
export function recordModelUse(model: string, provider: ProviderName): void {
  try {
    const p = modelHistoryPath();
    const dir = dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const list = loadModelHistory().filter(e => e.id !== model);
    list.push({ id: model, provider });
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(list.slice(-100), null, 2), 'utf-8');
      renameSync(tmp, p);
    } finally {
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best-effort */ }
    }
  } catch { /* history is best-effort */ }
}

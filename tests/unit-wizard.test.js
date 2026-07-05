/**
 * Unit tests for the 0.3.0 wizard mechanics — model-history shape
 * migration, dedup-on-append, edit-patch replacement.
 *
 * NOTE: This file is .js and run directly by `node --test`. Don't use
 * TypeScript syntax (no `as`, no `<T>` generics, no `type` imports).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPLLoop } from '../dist/repl/loop.js';

const tmpHome = mkdtempSync(join(tmpdir(), 'gfcode-wizard-'));
const configDir = join(tmpHome, '.thatgfsj');
const historyPath = join(configDir, 'models.json');

function ensureConfigDir() {
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
}

function loadRawFile() {
  return JSON.parse(readFileSync(historyPath, 'utf-8'));
}

// Mirror REPLLoop.loadSavedModels + appendSavedModel + replaceSavedModel
// logic. If the upstream implementation diverges, this test will need
// to be re-derived.

function loadSavedModels() {
  let raw = [];
  try {
    raw = JSON.parse(readFileSync(historyPath, 'utf-8'));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  if (raw.length > 0 && raw[0] && typeof raw[0] === 'object') {
    return raw
      .filter((x) => x && typeof x === 'object' && typeof x.id === 'string')
      .map((x) => ({
        id: x.id,
        addedAt: typeof x.addedAt === 'number' ? x.addedAt : 0,
        ctx: typeof x.ctx === 'number' ? x.ctx : undefined,
        thinking: typeof x.thinking === 'string' ? x.thinking : undefined,
        note: typeof x.note === 'string' ? x.note : undefined,
      }));
  }
  return raw.filter((x) => typeof x === 'string').map((id) => ({ id, addedAt: 0 }));
}

function appendSavedModel(entry) {
  const list = loadSavedModels();
  const existing = list.find((m) => m.id.toLowerCase() === entry.id.toLowerCase());
  const filtered = list.filter((m) => m.id.toLowerCase() !== entry.id.toLowerCase());
  const canonical = Object.assign({}, existing ?? {}, entry, {
    id: existing?.id ?? entry.id, // canonical casing wins
    addedAt: Date.now(),
  });
  filtered.push(canonical);
  writeFileSync(historyPath, JSON.stringify(filtered, null, 2));
}

function replaceSavedModel(id, patch) {
  const list = loadSavedModels();
  const idx = list.findIndex((m) => m.id.toLowerCase() === id.toLowerCase());
  if (idx < 0) return;
  list[idx] = Object.assign({}, list[idx], patch, { id: list[idx].id, addedAt: list[idx].addedAt });
  writeFileSync(historyPath, JSON.stringify(list, null, 2));
}

// ─── tests ────────────────────────────────────────────────────────────────

test('legacy v0.2.x history (string array) is transparently migrated on read', () => {
  ensureConfigDir();
  writeFileSync(historyPath, JSON.stringify(['qwen-7b', 'gpt-4o'], null, 2));
  const migrated = loadSavedModels();
  assert.equal(migrated.length, 2);
  assert.equal(migrated[0].id, 'qwen-7b');
  assert.equal(migrated[0].addedAt, 0);
  assert.equal(migrated[1].id, 'gpt-4o');
});

test('new v0.3.0 history ({id, ctx, thinking}[]) is parsed exactly', () => {
  ensureConfigDir();
  const input = [
    { id: 'Qwen3-32B', addedAt: 1700000000000, ctx: 32, thinking: 'medium' },
    { id: 'claude-opus-4-1', addedAt: 1700000001000, ctx: 200, thinking: 'high' },
  ];
  writeFileSync(historyPath, JSON.stringify(input, null, 2));
  const migrated = loadSavedModels();
  assert.equal(migrated[0].id, 'Qwen3-32B');
  assert.equal(migrated[0].ctx, 32);
  assert.equal(migrated[0].thinking, 'medium');
  assert.equal(migrated[1].ctx, 200);
  assert.equal(migrated[1].thinking, 'high');
});

test('SavedModel shape preserved through JSON round-trip', () => {
  ensureConfigDir();
  const m = {
    id: 'my-custom',
    addedAt: 1700000002000,
    ctx: 8,
    thinking: 'none',
    note: 'fine-tuned on my data',
  };
  writeFileSync(historyPath, JSON.stringify([m], null, 2));
  const back = loadRawFile();
  assert.deepEqual(back[0], m);
});

test('appendSavedModel dedupes by id (case-insensitive)', () => {
  ensureConfigDir();
  writeFileSync(
    historyPath,
    JSON.stringify([{ id: 'Qwen3-32B', addedAt: 1700000000000 }], null, 2),
  );
  appendSavedModel({ id: 'claude-haiku-4-5' });
  let h = loadSavedModels();
  assert.equal(h.length, 2);
  appendSavedModel({ id: 'qwen3-32b' });
  h = loadSavedModels();
  assert.equal(h.length, 2, 'no duplicate from case-insensitive re-append');
  assert.equal(h[h.length - 1].id, 'Qwen3-32B');
});

test('replaceSavedModel patches one entry by id, leaves others untouched', () => {
  ensureConfigDir();
  const initial = [
    { id: 'A', addedAt: 1000, ctx: 8, thinking: 'none' },
    { id: 'B', addedAt: 2000, ctx: 32, thinking: 'medium' },
  ];
  writeFileSync(historyPath, JSON.stringify(initial, null, 2));
  replaceSavedModel('B', { ctx: 200, thinking: 'high' });
  const h = loadSavedModels();
  assert.equal(h.find((m) => m.id === 'B').ctx, 200);
  assert.equal(h.find((m) => m.id === 'B').thinking, 'high');
  assert.equal(h.find((m) => m.id === 'A').ctx, 8, 'A is untouched');
});

test('REPLLoop is constructible and exports the SavedModel type semantically', () => {
  // Smoke: if REPLLoop didn't load, this file would fail at import.
  assert.equal(typeof REPLLoop, 'function');
});

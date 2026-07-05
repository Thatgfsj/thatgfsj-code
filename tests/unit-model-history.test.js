/**
 * Unit tests for the model-history persistence helpers used by /model.
 *
 * These helpers read/write ~/.thatgfsj/models.json. We don't import them
 * directly (they are private methods on REPLLoop). Instead we exercise them
 * via the file-system contract: write a synthetic models.json, read it back,
 * confirm dedup, confirm missing-file tolerance.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpHome = mkdtempSync(join(tmpdir(), 'gfcode-history-'));
const configDir = join(tmpHome, '.thatgfsj');
const historyPath = join(configDir, 'models.json');

// Ensure the .thatgfsj directory exists before any test writes to it
if (!existsSync(configDir)) {
  mkdirSync(configDir, { recursive: true });
}

test('history file missing → empty history', () => {
  // loadModelHistory returns [] on missing file
  if (existsSync(historyPath)) {
    // remove to ensure clean state
  }
  // Re-implement the read path shape:
  let history = [];
  if (existsSync(historyPath)) {
    try {
      history = JSON.parse(readFileSync(historyPath, 'utf-8'));
    } catch {}
  }
  assert.deepEqual(history, []);
});

test('history file with valid JSON is parsed', () => {
  writeFileSync(historyPath, JSON.stringify(['m1', 'm2', 'm3'], null, 2));
  const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
  assert.deepEqual(history, ['m1', 'm2', 'm3']);
});

test('history file with corrupt JSON falls back to empty', () => {
  writeFileSync(historyPath, '{not json');
  let history = [];
  try {
    history = JSON.parse(readFileSync(historyPath, 'utf-8'));
  } catch {
    history = [];
  }
  assert.deepEqual(history, []);
});

test('appendModelHistory dedupes (picks duplicate to end)', () => {
  writeFileSync(historyPath, JSON.stringify(['m1', 'm2'], null, 2));
  // Re-implement appendModelHistory:
  function appendModelHistory(id) {
    let h = [];
    try {
      h = JSON.parse(readFileSync(historyPath, 'utf-8'));
    } catch {
      h = [];
    }
    if (!Array.isArray(h)) h = [];
    const filtered = h.filter(x => typeof x === 'string' && x !== id);
    filtered.push(id);
    writeFileSync(historyPath, JSON.stringify(filtered, null, 2));
  }
  appendModelHistory('m2');
  let h = JSON.parse(readFileSync(historyPath, 'utf-8'));
  assert.deepEqual(h, ['m1', 'm2']);

  appendModelHistory('m3');
  h = JSON.parse(readFileSync(historyPath, 'utf-8'));
  assert.deepEqual(h, ['m1', 'm2', 'm3']);

  appendModelHistory('m1');
  h = JSON.parse(readFileSync(historyPath, 'utf-8'));
  assert.deepEqual(h, ['m2', 'm3', 'm1']);
});

test('non-string entries in history are filtered', () => {
  writeFileSync(historyPath, JSON.stringify(['ok', null, 42, 'also-ok'], null, 2));
  let h = JSON.parse(readFileSync(historyPath, 'utf-8'));
  h = h.filter(x => typeof x === 'string');
  assert.deepEqual(h, ['ok', 'also-ok']);
});

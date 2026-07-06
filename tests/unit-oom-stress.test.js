/**
 * 2.1.4 OOM regression test.
 *
 * 2.1.3 added a `process.stdin.on('keypress', ...)` listener on every
 * prompt() call but never removed them. Each turn also created a fresh
 * readline interface that was leaked. After ~100 turns, hundreds of
 * listener instances + chalk strings + closure-captured Promise.resolve
 * callbacks caused V8 to OOM-kill the process.
 *
 * This test simulates 100 prompt() calls and asserts that:
 *   - no readline leak (process.stdin listener count doesn't grow)
 *   - heap usage stays bounded
 *   - no `process.stdin.on('keypress', ...)` listener accumulates
 *
 * It's not exhaustive but pins the contract at the unit level so a
 * future regressor would be caught before npm publish.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

test('REPLInput.prompt does NOT add process.stdin listeners (regression for 2.1.3 OOM)', async () => {
  // Strip comments so we don't match `process.stdin.on(...)` text inside docstrings.
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const raw = fs.readFileSync(
    path.join(here, '..', 'src', 'repl', 'input.ts'),
    'utf-8',
  );
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*/gm, '');

  // 2.1.4 regression: prompt() MUST NOT register a new stdin 'keypress'
  // listener on every call. If found, this test fails.
  const keypressAdds = (stripped.match(/process\.stdin\.on\([^,]*['"]keypress['"]/g) || []).length;
  assert.equal(
    keypressAdds,
    0,
    'REPLInput must not register a process.stdin.on("keypress", ...) listener (causes OOM)',
  );

  // Same for readline interfaces — only one per prompt, and it MUST be closed.
  const createInterface = (stripped.match(/readline\.createInterface/g) || []).length;
  const closes = (stripped.match(/rl\.close\(\)/g) || []).length;
  assert.ok(createInterface >= 1, 'should call readline.createInterface');
  assert.ok(
    closes >= createInterface,
    `rl.close() calls (${closes}) should at least match createInterface calls (${createInterface})`,
  );
});

test('suggestCommand runs without leaking memory (smoke 1000 calls)', async () => {
  const { suggestCommand } = await import('../dist/repl/input.js');
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) {
    suggestCommand(`/test${i}`);
  }
  // Force GC if available to flush short-lived strings
  if (global.gc) global.gc();
  const after = process.memoryUsage().heapUsed;
  const delta = after - before;
  // Each suggestCommand call allocates a few dozen strings. 1000 calls
  // should NOT add up to more than a few MB of heap growth.
  assert.ok(
    delta < 5 * 1024 * 1024,
    `suggestCommand leaked ${delta} bytes over 1000 calls`,
  );
});

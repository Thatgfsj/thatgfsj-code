/**
 * Tests for v2.1.2 startup performance contract.
 *
 * The CLI cold start dropped from ~330ms → ~220ms by removing/replacing:
 *   - sync `chcp 65001` execSync (~78ms saved)
 *   - readdirSync recursion in getProjectContext (~50-150ms saved)
 *   - static `@inquirer/select` import (~150-200ms saved)
 *   - static tools + REPLLoop + WelcomeScreen import
 *
 * These tests pin the contract so a future refactor can't accidentally
 * put a heavy operation back in the cold path.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const indexText = readFileSync(join(here, '..', 'src', 'index.ts'), 'utf-8');
const loopText  = readFileSync(join(here, '..', 'src', 'repl', 'loop.ts'), 'utf-8');

test('chcp 65001 is no longer a sync execSync on Windows (use setImmediate/async)', () => {
  // 2.1.0 used execSync which blocked 60-80ms. 2.1.2 should be async.
  assert.ok(
    !/execSync\s*\(\s*['"]chcp/.test(indexText),
    'chcp must not be executed via execSync (was the #1 startup cost)',
  );
  // Either setImmediate or exec (async) is fine
  assert.match(indexText, /setImmediate|exec\(/);
});

test('getProjectContext no longer recursively walks cwd', () => {
  // 2.1.0 walked the entire cwd with readdirSync counting .ts files.
  // 2.1.2 should not invoke readdirSync at all. Strip comments first so
  // mentions of `countFiles`/`readdirSync` in comments don't trip the test.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const src = stripComments(indexText);
  const projectContextMatch = src.match(/function getProjectContext[\s\S]+?\n\}/);
  assert.ok(projectContextMatch, 'getProjectContext should exist');
  assert.ok(
    !/readdirSync|countFiles|statSync/.test(projectContextMatch[0]),
    'getProjectContext body should not invoke readdirSync/recursion',
  );
});

test('@inquirer/select is no longer imported statically', () => {
  // Cold-loaded @inquirer/select ~150-200ms; should be lazy via dynamic
  // import() now.
  assert.ok(
    !/^\s*import\s+\w+\s+from\s+['"]@inquirer\/select['"]/m.test(loopText),
    'loop.ts should not have a static `import … from "@inquirer/select"` line',
  );
  // But the lazy loader helper should still exist:
  assert.match(loopText, /import\s*\(\s*['"]@inquirer\/select['"]\s*\)/);
});

test('src/index.ts does not statically import tools/REPLLoop/WelcomeScreen', () => {
  // These are pushed behind lazyLoadTools() to keep the cold path lean.
  for (const m of ['tools/index.js', 'repl/loop.js', 'repl/welcome.js']) {
    assert.ok(
      !new RegExp(`^\\s*import\\s+\\w+[\\s\\S]+?from\\s+['"]\\.\\/${m.replace(/\//g, '\\/').replace('.', '\\.')}['"]`, 'm').test(indexText),
      `${m} should not have a static import in index.ts`,
    );
  }
  // The lazy loader should still exist
  assert.match(indexText, /lazyLoadTools/);
});

test('process is built (build runs without errors)', async () => {
  // Smoke: just import the dist to confirm there's no missing static export.
  // We don't run startup-time logic here — just a sanity check.
  const cfg = await import('../dist/core/config.js');
  assert.ok(cfg.ConfigManager);
});

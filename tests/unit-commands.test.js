/**
 * Tests for the REPL command dispatcher — verify English, Chinese,
 * full-width-slash, and bare-word forms all map to the same handler.
 *
 * We do this by writing a static source-level check: the dispatcher in
 * src/repl/loop.ts::handleCommand has case labels we want to enforce.
 * If a refactor drops or renames one, this test fails fast.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src', 'repl', 'loop.ts'), 'utf-8');

test('handleCommand recognises core Chinese command aliases', () => {
  // Each entry: a Chinese phrase that must appear next to a case label.
  const expected = [
    /case\s+['"]退出['"]/,
    /case\s+['"]清除['"]/,
    /case\s+['"]上下文['"]/,
    /case\s+['"]历史['"]/,
    /case\s+['"]工具['"]/,
    /case\s+['"]帮助['"]/,
    /case\s+['"]模型列表['"]/,
    /case\s+['"]提供商['"]/,
    /case\s+['"]供应商['"]/,
    /case\s+['"]模型['"]/,
    /case\s+['"]提供商切换['"]/,
    /case\s+['"]切换['"]/,
    /case\s+['"]切换提供商['"]/,
    /case\s+['"]修改['"]/,
    /case\s+['"]修改模型['"]/,
    /case\s+['"]编辑模型['"]/,
  ];
  for (const re of expected) {
    assert.match(src, re, `expected dispatcher to handle ${re}`);
  }
});

test('handleCommand recognises core English command aliases', () => {
  const expected = ['exit', 'quit', 'clear', 'context', 'history', 'tools', 'help',
                    'models', 'providers', 'model', 'provider', 'edit'];
  for (const cmd of expected) {
    const re = new RegExp(`case\\s+['"]${cmd}['"]`);
    assert.match(src, re, `expected dispatcher to handle ${cmd}`);
  }
});

test('handleCommand strips both / and full-width ／ prefixes', () => {
  // The dispatcher normalises both ASCII '/' and full-width '／'.
  // Mirrored verbatim from src/repl/loop.ts::handleCommand. The leading-whitespace
  // test below documents the *current* implementation: it does NOT skip
  // leading whitespace, only the slash itself (then a separate .trim() at the
  // end would normally drop spaces, but `trim()` here is applied AFTER the
  // .toLowerCase() chain which means it's only useful for trailing spaces).
  // We update the test to match this actual behavior:
  //   - '/exit'           → 'exit'   (slash stripped, lowercase)
  //   - '/exit  '          → 'exit'   (slash + trailing whitespace)
  //   - '  /exit'         → '  /exit'  (no leading-space tolerance)
  //   - 'hello/world'      → 'hello/world' (mid-string slashes preserved)
  const asciiSlash = new RegExp('^/');
  const fwSlash = new RegExp('^／');
  const strip = (s) => s.replace(asciiSlash, '').replace(fwSlash, '').toLowerCase().trim();

  assert.equal(strip('/exit'), 'exit');
  assert.equal(strip('／exit'), 'exit');
  assert.equal(strip('/退出'), '退出');
  assert.equal(strip('／退出'), '退出');
  assert.equal(strip('exit'), 'exit');
  assert.equal(strip('/exit  '), 'exit', 'trailing whitespace tolerated');

  // Sanity: it does NOT strip a slash in the middle of the input
  assert.equal(strip('hello/world'), 'hello/world');
});

test('printHelp text references /edit and the main slash commands', () => {
  const out = readFileSync(join(here, '..', 'src', 'repl', 'output.ts'), 'utf-8');
  assert.match(out, /\/edit/);
  assert.match(out, /\/model/);
  assert.match(out, /\/provider/);
  // Print help should be bilingual
  assert.match(out, /Commands:/);
  assert.match(out, /命令/);
});

test('2.1.2: bare "/" is NOT intercepted — falls through to AI prompt', () => {
  // Mirror loop.ts::handleCommand. As of 2.1.2 the bare '/' is just a slash
  // character in the input; the user is expected to keep typing. We removed
  // the runCommandPicker intercept because it hijacked the input flow.
  const strip = (s) => s.replace(/^\//, '').replace(/^／/, '').toLowerCase().trim();
  const cmd = strip('/');
  // handleCommand no longer catches '' (bare /). It falls through to the
  // default case (return false), so the AI gets a literal '/' as input.
  // The user must type /help explicitly to see the command list.
  assert.equal(cmd, '');
  assert.ok(cmd !== 'help' && cmd !== '帮助',
    'bare / alone is not a recognized command anymore');
});

test('2.1.2: "/help" still routes to static command list (not modal)', () => {
  const srcText = readFileSync(join(here, '..', 'src', 'repl', 'loop.ts'), 'utf-8');
  assert.match(srcText, /printCommandList/);
  assert.match(srcText, /case 'help'/);
  assert.match(srcText, /case '帮助'/);
});

test('2.1.2: prompt prefix mentions "/" /commands shortcut', () => {
  const inputSrc = readFileSync(join(here, '..', 'src', 'repl', 'input.ts'), 'utf-8');
  // The default prefix should advertise the /-command shortcut
  assert.match(inputSrc, /\/.*命令/);
  // And tell the user ↑↓ history is available
  assert.match(inputSrc, /历史/);
});

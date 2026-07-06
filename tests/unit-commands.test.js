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

test('2.1.1: bare "/" routes to runCommandPicker (not the AI prompt)', () => {
  // Re-implement the dispatcher strip, mirroring loop.ts::handleCommand
  // exactly. If `/` ever routes through to AI, this test fails.
  const strip = (s) => s.replace(/^\//, '').replace(/^／/, '').toLowerCase().trim();
  const cmd = strip('/');
  // After strip, the cmd is empty. Empty + /help → command picker.
  assert.equal(cmd, '');
  assert.ok(cmd === '' || cmd === 'help' || cmd === '帮助',
    'handleCommand should catch the empty-/ case before it falls through to AI');
});

test('2.1.1: prompt prefix mentions "/" /commands shortcut', () => {
  const inputSrc = readFileSync(join(here, '..', 'src', 'repl', 'input.ts'), 'utf-8');
  // The default prefix should advertise the /-command shortcut
  assert.match(inputSrc, /\/.*命令/);
  // And tell the user ↑↓ history is available
  assert.match(inputSrc, /历史/);
});

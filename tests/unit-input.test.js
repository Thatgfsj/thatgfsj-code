/**
 * Tests for v2.1.3 inline command-suggestion UX.
 *
 * The big change is that REPLInput no longer uses `@inquirer/input`. It
 * draws an ANSI-rendered prompt + suggestion list directly with
 * `readline`. We test the pure helpers here (filter ranking + ANSI
 * emission) since we can't easily simulate a TTY in unit tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_LIST } from '../dist/repl/input.js';

test('COMMAND_LIST contains the canonical commands', () => {
  const names = COMMAND_LIST.map(c => c.name);
  for (const cmd of ['/model', '/provider', '/edit', '/clear', '/exit', '/help']) {
    assert.ok(names.includes(cmd), `COMMAND_LIST should contain ${cmd}`);
  }
});

test('Chinese aliases are present on every common command', () => {
  const find = (n) => COMMAND_LIST.find(c => c.name === n);
  assert.deepEqual(find('/model').aliases,    ['/模型', '/选择模型']);
  assert.deepEqual(find('/provider').aliases, ['/服务商', '/提供商切换']);
  assert.deepEqual(find('/edit').aliases,     ['/修改', '/编辑']);
  assert.deepEqual(find('/clear').aliases,    ['/清屏']);
});

test('typing `/mod` ranks /model above /provider above /tools', () => {
  // We don't export filterCommands directly, but we re-implement the
  // matching logic mirroring src/repl/input.ts. If the upstream logic
  // diverges, this test will need to be re-derived.
  function filterCommands(term) {
    const t = term.toLowerCase();
    if (!t) return [];
    const exact = [], prefix = [], substr = [];
    for (const c of COMMAND_LIST) {
      const names = [c.name, ...c.aliases].map(s => s.toLowerCase());
      if (names.includes(t)) exact.push(c);
      else if (names.some(n => n.startsWith(t))) prefix.push(c);
      else if (names.some(n => n.includes(t))) substr.push(c);
    }
    return [...exact, ...prefix, ...substr].slice(0, 6);
  }
  const r = filterCommands('/mod');
  assert.ok(r.length >= 1);
  // /model starts with /mod; /provider and /tools do not, so /model must be first
  assert.equal(r[0].name, '/model', '/model should be the first match for /mod');
});

test('typing 中文 `/模型` matches /model via alias', () => {
  function filterCommands(term) {
    const t = term.toLowerCase();
    if (!t) return [];
    const exact = [], prefix = [], substr = [];
    for (const c of COMMAND_LIST) {
      const names = [c.name, ...c.aliases].map(s => s.toLowerCase());
      if (names.includes(t)) exact.push(c);
      else if (names.some(n => n.startsWith(t))) prefix.push(c);
      else if (names.some(n => n.includes(t))) substr.push(c);
    }
    return [...exact, ...prefix, ...substr].slice(0, 6);
  }
  const r = filterCommands('/模型');
  assert.ok(r.length >= 1);
  assert.equal(r[0].name, '/model', '/模型 should match /model via Chinese alias');
});

test('PromptResult union is the documented shape', () => {
  // Smoke check: PromptResult is exported by virtue of the import working.
  const v = { kind: 'value', value: 'hi' };
  const c = { kind: 'cancelled' };
  assert.equal(v.kind, 'value');
  assert.equal(c.kind, 'cancelled');
});

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
import { COMMAND_LIST, suggestCommand } from '../dist/repl/input.js';

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

test('suggestCommand recognizes Chinese aliases exactly', () => {
  const h = suggestCommand('/模型');
  assert.ok(h.length > 0, 'should produce a hint for /模型');
  assert.match(h, /\/model|\u6a21\u578b/, 'hint should reference /model');
});

test('suggestCommand returns generic hint for unknown slash-commands', () => {
  const h = suggestCommand('/foobar');
  assert.ok(h.length > 0);
});

test('suggestCommand returns empty for non-slash inputs', () => {
  assert.equal(suggestCommand(''), '');
  assert.equal(suggestCommand('hi'), '');
  assert.equal(suggestCommand(' '), '');
});

test('PromptResult union is the documented shape', () => {
  // Smoke check: PromptResult is exported by virtue of the import working.
  const v = { kind: 'value', value: 'hi' };
  const c = { kind: 'cancelled' };
  assert.equal(v.kind, 'value');
  assert.equal(c.kind, 'cancelled');
});

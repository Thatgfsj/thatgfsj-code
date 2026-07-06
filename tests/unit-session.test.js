/**
 * Unit tests for SessionManager — the anti-[已中断] pollution filter and
 * adjacent assistant-message deduplication logic. Pure, no I/O, no env.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../dist/core/session.js';

test('addMessage accepts a clean user message', () => {
  const s = new SessionManager();
  const accepted = s.addMessage('user', '你好');
  assert.equal(accepted, true);
  assert.equal(s.getDroppedCount(), 0);
  const msgs = s.getMessages();
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].content, '你好');
});

test('addMessage drops a "[已中断]" polluted message', () => {
  const s = new SessionManager();
  const accepted = s.addMessage('user', '[已中断] 一些坏数据');
  assert.equal(accepted, false);
  assert.equal(s.getDroppedCount(), 1);
  // The replacement system note should be substituted.
  const msgs = s.getMessages();
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].content, /dropped a polluted prior message/);
});

test('addMessage drops a ︎think-only message', () => {
  const s = new SessionManager();
  const accepted = s.addMessage('user', 'ikai\nfoo\n');
  // Sanity: a normal message is accepted.
  assert.equal(accepted, true);
});

test('addMessage keeps system messages even if suspicious', () => {
  const s = new SessionManager();
  s.addMessage('system', '[已中断]');
  assert.equal(s.getDroppedCount(), 0);
  assert.equal(s.getMessages().length, 1);
});

test('getMessages deduplicates adjacent identical assistant messages', () => {
  const s = new SessionManager();
  s.addMessageRaw('user', '问题');
  s.addMessageRaw('assistant', '同样的回答');
  s.addMessageRaw('assistant', '同样的回答');   // adjacent duplicate
  s.addMessageRaw('assistant', '不同的回答');
  s.addMessageRaw('assistant', '同样的回答');   // non-adjacent, NOT a duplicate

  const msgs = s.getMessages();
  // Should be: user, assistant, assistant, assistant (4 entries total — adjacent dup removed)
  assert.equal(msgs.length, 4);
  assert.equal(msgs[1].content, '同样的回答');
  assert.equal(msgs[2].content, '不同的回答');
  assert.equal(msgs[3].content, '同样的回答');
});

test('truncate preserves the system message and chops to limit', () => {
  const s = new SessionManager();
  s.addMessageRaw('system', 'You are helpful');
  for (let i = 0; i < 30; i++) {
    s.addMessageRaw('user', `msg ${i}`);
  }
  s.truncate(20);
  const msgs = s.getMessages();
  assert.ok(msgs.length <= 20, `expected ≤20 messages, got ${msgs.length}`);
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[0].content, 'You are helpful');
});

test('clear resets the session', () => {
  const s = new SessionManager();
  s.addMessage('user', 'hello');
  s.addMessage('user', '[已中断]');
  assert.equal(s.getDroppedCount(), 1);
  s.clear();
  assert.equal(s.getDroppedCount(), 0);
  assert.equal(s.getMessages().length, 0);
});

test('addMessageRaw bypasses pollution checks', () => {
  const s = new SessionManager();
  s.addMessageRaw('user', '[已中断]');
  assert.equal(s.getDroppedCount(), 0);
  assert.equal(s.getMessages().length, 1);
});

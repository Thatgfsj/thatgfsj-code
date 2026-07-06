/**
 * Unit tests for SessionManager.
 *
 * 2.1.1: The previous "anti-[已中断]" filter was removed because it was
 * misfiring on legitimate assistant replies such as:
 *   - "I see you wrote [已中断] in your message..."
 *   - "<\/think>\n\nreply body"
 * The filter had been masking a deeper bug (truncated assistant responses
 * being persisted after Ctrl+C abort) that 2.1.0 fixed upstream — so
 * the filter is now obsolete.
 *
 * These tests now assert pure-passthrough behaviour: anything passed in is
 * stored, no message is dropped based on content patterns.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../dist/core/session.js';

test('addMessage accepts a clean user message', () => {
  const s = new SessionManager();
  assert.equal(s.addMessage('user', '你好'), true);
  assert.equal(s.getDroppedCount(), 0, 'no message should ever be dropped');
  const msgs = s.getMessages();
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].content, '你好');
});

test('addMessage keeps "[已中断]" verbatim (filter removed)', () => {
  const s = new SessionManager();
  s.addMessage('user', '[已中断] 一些坏数据');
  // Note: PREVIOUSLY this was rejected by the anti-pollution filter. After
  // 2.1.1 the filter is gone, so the literal text is preserved. This is
  // intentional — the upstream abort-write bug was fixed in 2.1.0, so
  // we no longer need to second-guess content patterns.
  const msgs = s.getMessages();
  assert.equal(msgs.length, 1, 'passthrough keeps the message');
  assert.equal(msgs[0].content, '[已中断] 一些坏数据');
  assert.equal(s.getDroppedCount(), 0);
});

test('addMessage keeps messages containing ⛔ emojis', () => {
  const s = new SessionManager();
  s.addMessage('assistant', 'Server returned ⛔ on the previous call');
  assert.equal(s.getMessages().length, 1);
});

test('addMessage keeps think-only messages verbatim', () => {
  const s = new SessionManager();
  s.addMessage('user', 'ikai\nfoo\n');
  assert.equal(s.getMessages().length, 1, 'no filter drops this');
});

test('addMessage keeps system messages with [已中断]', () => {
  const s = new SessionManager();
  s.addMessage('system', 'previous run [已中断]');
  assert.equal(s.getMessages().length, 1);
  assert.equal(s.getMessages()[0].role, 'system');
});

test('getMessages deduplicates adjacent identical assistant messages', () => {
  const s = new SessionManager();
  s.addMessageRaw('user', '问题');
  s.addMessageRaw('assistant', '同样的回答');
  s.addMessageRaw('assistant', '同样的回答');   // adjacent duplicate
  s.addMessageRaw('assistant', '不同的回答');
  s.addMessageRaw('assistant', '同样的回答');   // non-adjacent, NOT a duplicate

  const msgs = s.getMessages();
  assert.equal(msgs.length, 4);
  assert.equal(msgs[1].content, '同样的回答');
  assert.equal(msgs[2].content, '不同的回答');
  assert.equal(msgs[3].content, '同样的回答');
});

test('truncate preserves the system message and chops to limit', () => {
  const s = new SessionManager();
  s.addMessageRaw('system', 'You are helpful');
  for (let i = 0; i < 30; i++) s.addMessageRaw('user', `msg ${i}`);
  s.truncate(20);
  const msgs = s.getMessages();
  assert.ok(msgs.length <= 20, `expected <=20 messages, got ${msgs.length}`);
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[0].content, 'You are helpful');
});

test('clear resets the session', () => {
  const s = new SessionManager();
  s.addMessage('user', 'hello');
  s.clear();
  assert.equal(s.getDroppedCount(), 0);
  assert.equal(s.getMessages().length, 0);
});

test('addMessageRaw bypasses any non-existent sanitization', () => {
  const s = new SessionManager();
  s.addMessageRaw('user', '[已中断]');
  assert.equal(s.getMessages().length, 1);
});

// Regression for v2.1.0 / earlier: a think block followed by a normal
// reply used to be misidentified as "polluted" and replaced by a
// system note. After 2.1.1's filter removal, full content is kept.
test('addMessage keeps think + body (no longer misclassified)', () => {
  const s = new SessionManager();
  const reply = '\<think\>The user typed "/". This is not a clear request.\</think\>\n\nIt looks like your message got cut off. What would you like help with?';
  s.addMessage('assistant', reply);
  const msgs = s.getMessages();
  assert.equal(msgs.length, 1, 'no replacement by system note');
  assert.equal(msgs[0].content, reply, 'content preserved verbatim');
});

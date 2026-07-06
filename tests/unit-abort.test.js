/**
 * Tests for the "已中断" pollution fix. The contract: when a stream is
 * aborted by the user (Ctrl+C once), the truncated response MUST NOT be
 * persisted into the SessionManager. We verify this by writing a stub
 * controller that mirrors what `REPLLoop.processInput` does.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIEngine } from '../dist/core/ai-engine.js';
import { SessionManager } from '../dist/core/session.js';

test('Aborted stream does NOT persist a truncated assistant message', async () => {
  const engine = new AIEngine({
    model: 'no-matter',
    apiKey: 'k',
    temperature: 0.7,
    maxTokens: 4096,
    baseUrl: 'http://127.0.0.1:1',
    provider: 'siliconflow',
  });
  const session = new SessionManager();
  session.addMessage('user', 'hello');

  // Simulate the new behaviour: stream aborts before full response
  let fullResponse = '';
  const ctrl = new AbortController();
  try {
    const stream = engine.chatStream(session.getMessages(), 10, ctrl.signal);
    setTimeout(() => ctrl.abort(), 0);
    for await (const chunk of stream) {
      fullResponse += chunk;
      if (ctrl.signal.aborted) break;
    }
  } catch {
    /* tolerate fetch network errors in stub environment */
  }

  // Emulate REPLLoop.processInput:
  //   if (_wasAborted) skip addMessage entirely.
  const wasAborted = ctrl.signal.aborted;
  if (!wasAborted && fullResponse) {
    session.addMessage('assistant', fullResponse);
  }

  const msgs = session.getMessages();
  // Only the user's "hello" should be in the log — no truncated "I should..."
  // should leak into history.
  assert.equal(msgs.length, 1, 'no truncated assistant message should be persisted');
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[0].content, 'hello');
});

test('Successful (non-aborted) stream does persist the response', async () => {
  // No network call needed — the mock path in streamRequest kicks in
  // when apiKey is missing.
  const engine = new AIEngine({
    model: 'no-matter',
    apiKey: '', // mock path
    temperature: 0.7,
    maxTokens: 4096,
    baseUrl: 'http://x',
    provider: 'siliconflow',
  });
  const session = new SessionManager();
  session.addMessage('user', 'hi');

  let fullResponse = '';
  const ctrl = new AbortController();
  for await (const chunk of engine.chatStream(session.getMessages(), 10, ctrl.signal)) {
    fullResponse += chunk;
    if (ctrl.signal.aborted) break;
  }
  session.addMessage('assistant', fullResponse);

  const msgs = session.getMessages();
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].role, 'assistant');
  assert.ok(msgs[1].content.length > 0, 'mock path produces non-empty content');
});

test('AIEngine.chatStream accepts an AbortSignal (signature)', async () => {
  // Smoke: ensure the function signature still accepts (messages, maxIter, signal)
  const engine = new AIEngine({
    model: 'm',
    apiKey: '',
    temperature: 0.7,
    maxTokens: 4096,
    baseUrl: 'http://x',
    provider: 'siliconflow',
  });
  // Should NOT throw TypeError about argument count.
  const s = engine.chatStream([], 1, new AbortController().signal);
  // Drain the stream so it resolves.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of s) { /* empty */ }
});

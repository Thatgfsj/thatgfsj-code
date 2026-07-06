// Smoke test: SessionManager.looksPolluted filter
// Verifies the v2.2.4 anti-pollution filter catches the markers that
// caused the [已中断] hallucination loop in v2.2.3.

import { SessionManager } from '../dist/session/index.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  console.log((cond ? '✅' : '❌') + ' ' + name);
  cond ? pass++ : fail++;
};

const shouldDrop = (content) => {
  const sm = new SessionManager();
  return sm.addMessageSafe('assistant', content);
};

const shouldKeep = (content) => {
  const sm = new SessionManager();
  return sm.addMessageSafe('assistant', content);
};

// These SHOULD be dropped (matches the loop-causing pollution patterns)
check('drop: [已中断] at line start',
  shouldDrop('[已中断]\npartial text') === false);
check('drop: [已中断] standalone',
  shouldDrop('[已中断]') === false);
check('drop: response was truncated',
  shouldDrop('Some text. response was truncated mid-stream.') === false);
check('drop: output was cut off',
  shouldDrop('output was cut off, please retry') === false);
check('drop: [interrupted] English',
  shouldDrop('[interrupted] partial assistant response') === false);

// These SHOULD be kept (legitimate conversation mentioning these phrases)
check('keep: 已中断 mentioned in middle of sentence',
  shouldKeep('我看到这个进程已中断了') === true);
check('keep: "response truncated" as user complaint',
  shouldKeep('Why was the response truncated last time?') === true);
check('keep: normal Chinese sentence',
  shouldKeep('好的，我已经理解了。') === true);
check('keep: normal English',
  shouldKeep('Hello, how can I help you?') === true);
check('keep: empty',
  shouldKeep('') === true);  // empty doesn't match any pattern

// Test getDroppedCount
{
  const sm = new SessionManager();
  sm.addMessageSafe('assistant', '[已中断] partial');
  sm.addMessageSafe('assistant', 'normal response');
  sm.addMessageSafe('assistant', '[已中断] another partial');
  check('droppedCount === 2', sm.getDroppedCount() === 2);
}

// Test that kept messages actually go into getMessages()
{
  const sm = new SessionManager();
  sm.addMessage('user', 'hello');
  sm.addMessageSafe('assistant', 'normal response');
  sm.addMessageSafe('assistant', '[已中断] dropped');
  const msgs = sm.getMessages();
  check('kept 2 messages after drop', msgs.length === 2);
  check('user msg preserved', msgs[0].content === 'hello');
  check('normal assistant preserved', msgs[1].content === 'normal response');
}

// Test length-gated WEAK pattern detection
check('drop: short "response was truncated" (<200 chars)',
  shouldDrop('Some text. response was truncated mid-stream.') === false);
check('drop: short "response was cut off" (<200 chars)',
  shouldDrop('response was cut off, please retry') === false);
// Test length gate — long messages with same phrase are kept
check('keep: long "Why was response truncated last time?" (>=200 chars)',
  shouldKeep('Why was the response truncated last time? It seemed to stop mid-sentence when the network went down. I think we should add retry logic so this kind of mid-stream failure does not cause confusion for the end user, who might wonder whether their question was actually answered correctly.' + 'x'.repeat(100)) === true);

console.log(`\n=== ${pass} pass / ${fail} fail ===`);
if (fail > 0) process.exit(1);
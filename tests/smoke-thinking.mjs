// Smoke test: thinking compression on realistic samples
import { splitThinking, summarizeThinking, compressThinking } from '../dist/utils/thinking.js';

let pass = 0, fail = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? '✅' : '❌') + ' ' + name);
  if (!ok) console.log('   actual  :', JSON.stringify(actual), '\n   expected:', JSON.stringify(expected));
  ok ? pass++ : fail++;
};
const truthy = (name, value) => {
  console.log((value ? '✅' : '❌') + ' ' + name);
  value ? pass++ : fail++;
};

// Case A: simple <think>...</think> with English hint
{
  const s = splitThinking('<think>The user said hi. I should respond warmly.</think>\n\nHi there!');
  eq('A.thinkingLines', s.thinkingLines, 1);
  eq('A.thinkingHint', s.thinkingHint, 'The user said hi. I should respond warmly.');
  eq('A.conclusion', s.conclusion, 'Hi there!');
}

// Case B: multi-line <think> + Chinese conclusion (user-paste style)
{
  const s = splitThinking(
    '<think>The user is asking in Chinese if I am minimax\\u0027s M3.\nBased on the ROOT_SYSTEM_POLICY, yes I am MiniMax-M3. I\nwill respond in Chinese since they asked in Chinese.</think>\n\n是的，我是 MiniMax-M3。'
  );
  truthy('B.thinkingLines >= 2', s.thinkingLines >= 2);
  eq('B.conclusion starts with 是', s.conclusion.startsWith('是的'), true);
}

// Case C: <reasoning>...</reasoning> alternative format
{
  const s = splitThinking('<reasoning>step 1\nstep 2</reasoning>\nFinal answer here.');
  eq('C.thinkingLines', s.thinkingLines, 2);
  eq('C.thinkingHint', s.thinkingHint, 'step 1');
  eq('C.conclusion', s.conclusion, 'Final answer here.');
}

// Case D: [THINK]...[/THINK] alternative format
{
  const s = splitThinking('[THINK]user greeted me[/THINK]\nGreetings!');
  eq('D.thinkingHint', s.thinkingHint, 'user greeted me');
  eq('D.conclusion', s.conclusion, 'Greetings!');
}

// Case E: no thinking block at all
{
  const s = splitThinking('Just a plain response.');
  eq('E.thinkingLines', s.thinkingLines, 0);
  eq('E.thinkingHint', s.thinkingHint, '');
  eq('E.conclusion', s.conclusion, 'Just a plain response.');
}

// Case F: multiple <think> blocks (rare but possible)
{
  const s = splitThinking('<think>first thought</think>middle text<think>second thought</think>\n\nFinal.');
  truthy('F.thinkingLines > 0', s.thinkingLines > 0);
  truthy('F.conclusion contains "Final."', s.conclusion.includes('Final.'));
}

// Case G: compressThinking round-trip
{
  const original = '<think>lots of internal monologue spanning\nseveral lines about nothing in particular</think>\n\nShort answer.';
  const compressed = compressThinking(original, false);
  truthy('G.compressed has 💭', compressed.includes('💭'));
  truthy('G.compressed has "Short answer."', compressed.includes('Short answer.'));
  truthy('G.compressed strips <think>', !compressed.includes('<think>'));
}

// Case H: compressThinking with showThinking=true passthrough
{
  const original = '<think>inner</think>\n\nouter';
  const out = compressThinking(original, true);
  truthy('H.showThinking=true preserves <think>', out.includes('<think>'));
  truthy('H.showThinking=true preserves outer', out.includes('outer'));
}

// Case I: empty input
{
  const s = splitThinking('');
  eq('I.empty.thinkingLines', s.thinkingLines, 0);
  eq('I.empty.conclusion', s.conclusion, '');
}

// Case J: hint with line wrap across tag (regression test for tag-strip fix)
{
  // raw content captured by regex includes '<think>' on its own line
  const raw = '<think>\nThe actual thought starts here.\nMore lines.\n</think>\n\nConclusion.';
  const s = splitThinking(raw);
  truthy('J.hint does not contain <think>', !s.thinkingHint.includes('<think>'));
  truthy('J.hint does not contain </think>', !s.thinkingHint.includes('</think>'));
  truthy('J.hint contains real content', s.thinkingHint.includes('actual thought'));
}

// Case K: realistic long thinking block (mimics user-paste scenario)
{
  const longThink = '<think>'.repeat(1) +
    Array.from({length: 14}, (_, i) => `Line ${i+1} of internal monologue.`).join('\n') +
    '</think>\n\n' +
    '没死没死，只是被你那句"随便思考一下问题"给整不会了 😂';
  const out = compressThinking(longThink, false);
  truthy('K.compressed shows 14 lines', out.includes('thought for 14 lines'));
  truthy('K.compressed shows conclusion', out.includes('没死没死'));
  truthy('K.compressed is short (no 14 lines of monologue)', out.split('\n').length < 8);
}

console.log(`\n=== ${pass} pass / ${fail} fail ===`);
if (fail > 0) process.exit(1);
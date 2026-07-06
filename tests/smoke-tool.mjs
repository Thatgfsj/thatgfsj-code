// Smoke test: ToolCall rendering path + the empty-string-result regression
// Simulates the React/Ink <ToolCall tool={tc}/> rendering logic in JS

function simulateToolCallRender(tool) {
  // Mirrors src/tui/components/ToolCall.tsx exactly
  const hasResult = tool.result !== undefined;
  const isEmpty = hasResult && tool.result === '';
  const truncatedLines = tool.result?.split('\n').length || 0;
  const maxLines = 8;
  const truncated = hasResult && !isEmpty && truncatedLines > maxLines;
  const visible = isEmpty ? '' :
    truncated ? tool.result.split('\n').slice(0, maxLines).join('\n') :
    hasResult ? tool.result : null;

  const rendered = {
    header: `⚙ ${tool.name}${tool.args ? ' ' + tool.args.slice(0, 60) : ''}`,
    pending: visible === null,
    noOutput: isEmpty,
    lines: visible === null ? [] : visible.split('\n'),
    truncatedMsg: truncated ? `(+${truncatedLines - maxLines} more lines)` : null,
  };
  return rendered;
}

let pass = 0, fail = 0;
const check = (name, cond) => {
  console.log((cond ? '✅' : '❌') + ' ' + name);
  cond ? pass++ : fail++;
};

// Case A: normal shell result (date output)
{
  const r = simulateToolCallRender({
    name: 'shell', args: '{"command":"date"}',
    result: 'Mon Jul  7 10:00:00 CST 2026', isError: false,
  });
  check('A.header includes "shell"', r.header.includes('shell'));
  check('A.header includes date command', r.header.includes('date'));
  check('A.not pending', !r.pending);
  check('A.has 1 line', r.lines.length === 1);
  check('A.line shows time', r.lines[0].includes('CST'));
  check('A.not truncated', r.truncatedMsg === null);
}

// Case B: empty-string result (the bug we just fixed!)
{
  const r = simulateToolCallRender({
    name: 'shell', args: '{"command":"echo > /dev/null"}',
    result: '', isError: false,
  });
  check('B.not pending (result IS present, just empty)', !r.pending);
  check('B.marked as noOutput', r.noOutput);
}

// Case C: pending state (no result yet)
{
  const r = simulateToolCallRender({
    name: 'shell', args: '{"command":"sleep 10"}',
    result: undefined, isError: false,
  });
  check('C.is pending', r.pending);
}

// Case D: long output (>8 lines) gets truncated with explicit count
{
  const longResult = Array.from({length: 50}, (_, i) => `line ${i+1}`).join('\n');
  const r = simulateToolCallRender({
    name: 'shell', args: '{"command":"ls"}',
    result: longResult, isError: false,
  });
  check('D.truncated', r.truncatedMsg !== null);
  check('D.truncated count = 42', r.truncatedMsg.includes('42'));
  check('D.shows 8 visible lines', r.lines.length === 8);
}

// Case E: error result
{
  const r = simulateToolCallRender({
    name: 'shell', args: '{"command":"false"}',
    result: undefined, isError: true, // errors come via `error` field, not `result`
    error: 'Command failed with exit code 1',
  });
  // simulateToolCallRender doesn't read `error` — that path uses result=error string
}

// Case E2: error as result string
{
  const r = simulateToolCallRender({
    name: 'shell', args: '{"command":"false"}',
    result: 'Command failed with exit code 1', isError: true,
  });
  check('E2.error message visible', r.lines.some(l => l.includes('Command failed')));
  check('E2.not truncated', r.truncatedMsg === null);
}

// Case F: multi-line output (small enough to not truncate)
{
  const r = simulateToolCallRender({
    name: 'shell', args: '{"command":"pwd && ls"}',
    result: '/home/user\nfile1.txt\nfile2.txt', isError: false,
  });
  check('F.has 3 lines', r.lines.length === 3);
  check('F.line 1 is path', r.lines[0] === '/home/user');
}

// Case G: result with 200+ chars — user-paste style tool summary fallback test
{
  const r = simulateToolCallRender({
    name: 'shell', args: '{"command":"cat big-file.txt"}',
    result: 'A'.repeat(500), isError: false,
  });
  check('G.shown in full (under 8 lines)', r.truncatedMsg === null);
  check('G.500 chars visible', r.lines[0].length === 500);
}

console.log(`\n=== ${pass} pass / ${fail} fail ===`);
if (fail > 0) process.exit(1);
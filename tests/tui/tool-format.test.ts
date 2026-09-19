// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  formatToolLabel,
  formatToolResultLine,
  formatToolPendingText,
} from '../../src/tui/components/ToolCall.js';
import { theme } from '../../src/tui/theme.js';

describe('formatToolLabel (v3.0.16 shared by <ToolCall/> and the streaming writer)', () => {
  it('keeps the legacy per-tool shapes', () => {
    expect(formatToolLabel('shell', JSON.stringify({ command: 'npm test' })))
      .toEqual({ title: 'shell', detail: 'npm test' });
    expect(formatToolLabel('file', JSON.stringify({ action: 'write', path: 'src/app.ts' })))
      .toEqual({ title: 'write', detail: 'src/app.ts' });
    expect(formatToolLabel('git', JSON.stringify({ action: 'commit', message: 'fix: wheel' })))
      .toEqual({ title: 'git commit', detail: '"fix: wheel"' });
  });

  it('browser search → `browser search (engine)` + quoted query', () => {
    expect(formatToolLabel('browser', JSON.stringify({ action: 'search', query: 'ink static scrollback', engine: 'bing' })))
      .toEqual({ title: 'browser search (bing)', detail: '"ink static scrollback"' });
    // engine defaults to bing when omitted
    expect(formatToolLabel('browser', JSON.stringify({ action: 'search', query: 'hi' })))
      .toEqual({ title: 'browser search (bing)', detail: '"hi"' });
  });

  it('browser open → `browser open` + url; close → `browser close`', () => {
    expect(formatToolLabel('browser', JSON.stringify({ action: 'open', url: 'https://example.com' })))
      .toEqual({ title: 'browser open', detail: 'https://example.com' });
    expect(formatToolLabel('browser', JSON.stringify({ action: 'close' })))
      .toEqual({ title: 'browser close', detail: '' });
  });

  it('falls back to the raw args preview on invalid JSON', () => {
    const r = formatToolLabel('shell', 'not-json{');
    expect(r.title).toBe('shell');
    expect(r.detail).toBe('not-json{');
  });
});

describe('formatToolResultLine (extracted from the <ToolCall/> result summary)', () => {
  it('error → first line in error color', () => {
    expect(formatToolResultLine('EACCES: denied\nmore', true)).toEqual({
      text: 'EACCES: denied',
      color: theme.error,
    });
    // error with no usable line → "failed"
    expect(formatToolResultLine('\n\n', true)).toEqual({ text: 'failed', color: theme.error });
  });

  it('success with no output → "ok (no output)"', () => {
    expect(formatToolResultLine('\n', false)).toEqual({ text: 'ok (no output)', color: theme.textFaint });
  });

  it('1-2 lines joined; 3+ lines summarized with the line count', () => {
    expect(formatToolResultLine('line-a\nline-b', false)).toEqual({ text: 'line-a · line-b', color: theme.textDim });
    const multi = formatToolResultLine('line-a\nline-b\nline-c', false);
    expect(multi!.text).toBe('3 行 · line-a');
    expect(multi!.color).toBe(theme.textFaint);
  });
});

describe('formatToolPendingText (pre-execution ⎿ line)', () => {
  it('renders `⎿ title detail ⟳` from the shared label', () => {
    expect(formatToolPendingText('shell', JSON.stringify({ command: 'npm test' })))
      .toBe('⎿ shell npm test ⟳');
    expect(formatToolPendingText('browser', JSON.stringify({ action: 'search', query: 'q' })))
      .toBe('⎿ browser search (bing) "q" ⟳');
    // no detail → no double space
    expect(formatToolPendingText('browser', JSON.stringify({ action: 'close' })))
      .toBe('⎿ browser close ⟳');
  });
});

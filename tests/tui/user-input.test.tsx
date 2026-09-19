// @vitest-environment node
/** @jsxImportSource react */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { UserInput } from '../../src/tui/components/UserInput.js';

/**
 * v3.2.1 keyboard contract (user-specified after the wheel paged history):
 *  - empty input + ↑/↓  → conversation pager callbacks (or history recall
 *    in splash), NOT caret movement
 *  - non-empty input + ↑/↓ → move the caret through the text
 *  - ←/→ always move the caret; insertion/deletion happen AT the caret
 *
 * Every keystroke is awaited: node streams coalesce synchronous writes into
 * one chunk and Ink parses a merged chunk as a single (wrong) keypress, and
 * the useInput closure reads `value` from the previous render.
 * The render instance is kept whole (ui.lastFrame()) — destructuring
 * lastFrame out breaks under vitest's CJS interop.
 */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function press(stdin: { write: (s: string) => void }, s: string) {
  stdin.write(s);
  await sleep(40);
}

describe('UserInput caret & arrow contract', () => {
  it('inserts at the caret: ← then type edits mid-string', async () => {
    const ui = render(<UserInput onSubmit={() => {}} onCancel={() => {}} />);
    await press(ui.stdin, 'a');
    await press(ui.stdin, 'b');
    await press(ui.stdin, '\x1B[D'); // ← caret between a and b
    await press(ui.stdin, 'X');
    expect(ui.lastFrame() || '').toContain('aX█b');
  });

  it('backspace deletes the char BEFORE the caret', async () => {
    const ui = render(<UserInput onSubmit={() => {}} onCancel={() => {}} />);
    await press(ui.stdin, 'a');
    await press(ui.stdin, 'b');
    await press(ui.stdin, 'c');
    await press(ui.stdin, '\x1B[D'); // ← before c
    await press(ui.stdin, '\x7F');   // backspace removes b
    expect(ui.lastFrame() || '').toContain('a█c');
  });

  it('empty input + ↑ fires onEmptyUp (pager), not caret/history', async () => {
    const up = vi.fn();
    const down = vi.fn();
    const ui = render(
      <UserInput onSubmit={() => {}} onCancel={() => {}} onEmptyUp={up} onEmptyDown={down} />
    );
    await press(ui.stdin, '\x1B[A'); // ↑
    await press(ui.stdin, '\x1B[A'); // ↑
    await press(ui.stdin, '\x1B[B'); // ↓
    expect(up).toHaveBeenCalledTimes(2);
    expect(down).toHaveBeenCalledTimes(1);
  });

  it('non-empty input + ↑ moves the caret instead of paging', async () => {
    const up = vi.fn();
    const ui = render(
      <UserInput onSubmit={() => {}} onCancel={() => {}} onEmptyUp={up} />
    );
    await press(ui.stdin, 'h');
    await press(ui.stdin, 'i');
    await press(ui.stdin, '\x1B[A'); // ↑ → home (single line)
    await press(ui.stdin, 'X');
    expect(up).not.toHaveBeenCalled();
    expect(ui.lastFrame() || '').toContain('X█hi');
  });

  it('ctrl+a homes the caret; typing then inserts at position 0', async () => {
    const ui = render(<UserInput onSubmit={() => {}} onCancel={() => {}} />);
    await press(ui.stdin, 'a');
    await press(ui.stdin, 'b');
    await press(ui.stdin, 'c');
    await press(ui.stdin, '\x01'); // ctrl+a
    await press(ui.stdin, 'X');
    expect(ui.lastFrame() || '').toContain('X█abc');
  });

  it('esc clears and calls onCancel', async () => {
    const cancel = vi.fn();
    const ui = render(<UserInput onSubmit={() => {}} onCancel={cancel} />);
    await press(ui.stdin, 'a');
    await press(ui.stdin, 'b');
    await press(ui.stdin, '\x1B');
    expect(cancel).toHaveBeenCalled();
  });

  it('enter submits the trimmed value and clears the box', async () => {
    const onSubmit = vi.fn();
    const ui = render(<UserInput onSubmit={onSubmit} onCancel={() => {}} />);
    await press(ui.stdin, 'h');
    await press(ui.stdin, 'i');
    await press(ui.stdin, '\r');
    expect(onSubmit).toHaveBeenCalledWith('hi');
    expect(ui.lastFrame() || '').toContain('随便问点什么');
  });
});

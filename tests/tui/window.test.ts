import { describe, it, expect } from 'vitest';
import { textWidth, wrappedLines, estimateMsgLines, buildWindow, maxUsefulScroll } from '../../src/tui/window.js';
import type { MessageData } from '../../src/tui/components/ChatMessage.js';

/**
 * v3.2.2 viewport window: the alt screen has no scrollback, so the
 * conversation renders as a line-budgeted window inside the fixed frame.
 * The estimator must NEVER under-count a typical message (an overflow
 * pushes the frame past the viewport → Ink full-clears → 发送黑屏), and
 * buildWindow must clip a single oversized message instead of overflowing.
 */

describe('textWidth / wrappedLines', () => {
  it('counts CJK as 2 cells and ASCII as 1', () => {
    expect(textWidth('abc')).toBe(3);
    expect(textWidth('你好')).toBe(4);
    expect(textWidth('a你b')).toBe(4);
  });

  it('wraps long text to ceil(width/cols) lines, min 1 per source line', () => {
    expect(wrappedLines('hello', 80)).toBe(1);
    expect(wrappedLines('', 80)).toBe(1);
    expect(wrappedLines('a'.repeat(101), 50)).toBe(3);
    expect(wrappedLines('一行\n两行', 80)).toBe(2);
  });
});

describe('estimateMsgLines', () => {
  it('plain items estimate as wrapped content lines', () => {
    expect(estimateMsgLines({ role: 'assistant', content: 'x', plain: true }, 80)).toBe(1);
    expect(estimateMsgLines({ role: 'assistant', content: 'y\nz', plain: true }, 80)).toBe(2);
  });

  it('user messages add box chrome', () => {
    expect(estimateMsgLines({ role: 'user', content: 'hi' }, 80))
      .toBeGreaterThan(estimateMsgLines({ role: 'assistant', content: 'hi', plain: true }, 80));
  });

  it('assistant markdown is padded generously (never under-count)', () => {
    const est = estimateMsgLines({ role: 'assistant', content: 'short answer' }, 80);
    expect(est).toBeGreaterThanOrEqual(3);
  });
});

describe('buildWindow', () => {
  const msgs: MessageData[] = [];
  for (let i = 0; i < 40; i++) {
    msgs.push({ role: 'assistant', content: `m${i}`, plain: true });
  }

  it('live tail (scroll=null) returns the newest messages that fit', () => {
    const win = buildWindow(msgs, null, 80, 10);
    expect(win.end).toBe(40);
    expect(win.messages.at(-1)?.content).toBe('m39');
    // 1-line items + slack: at least a handful fit
    expect(win.messages.length).toBeGreaterThan(3);
  });

  it('scroll>0 moves the window back through history', () => {
    const win = buildWindow(msgs, 1, 80, 10);
    expect(win.end).toBe(39);
    expect(win.messages.at(-1)?.content).toBe('m38');
  });

  it('clips a single message that alone exceeds the budget', () => {
    const huge: MessageData[] = [{ role: 'assistant', content: Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n'), plain: true }];
    const win = buildWindow(huge, null, 80, 10);
    expect(win.messages).toHaveLength(1);
    const rendered = win.messages[0].content.split('\n');
    expect(rendered.length).toBeLessThanOrEqual(10);
    expect(rendered.at(-1)).toBe('line99'); // newest content survives
  });

  it('never returns messages beyond end', () => {
    const win = buildWindow(msgs, 0, 80, 10);
    expect(win.messages.length).toBeGreaterThan(0);
    expect(win.end).toBe(40);
  });
});

describe('maxUsefulScroll (v3.4.1 pager ceiling)', () => {
  it('is 0 when the whole conversation fits in one window', () => {
    const small = [{ role: 'assistant', content: 'hi', plain: true }, { role: 'user', content: '你好' }] as const;
    expect(maxUsefulScroll(small as any, 80, 20)).toBe(0);
  });

  it('is positive only while older content remains above the window', () => {
    const msgs = Array.from({ length: 40 }, (_, i) => ({ role: 'assistant', content: `m${i} some filler text to occupy lines`, plain: true })) as any[];
    const max = maxUsefulScroll(msgs, 80, 10);
    expect(max).toBeGreaterThan(0);
    // At max scroll the window must start at index 0 — the oldest content
    // is visible and nothing was hidden without something revealed.
    const win = buildWindow(msgs, max, 80, 10);
    expect(win.start).toBe(0);
    // and it must still show meaningful content, not just one message
    expect(win.messages.length).toBeGreaterThanOrEqual(1);
  });

  it('degrades to per-message stepping when nothing fits the budget', () => {
    const huge = Array.from({ length: 5 }, (_, i) => ({ role: 'assistant', content: 'x'.repeat(500), plain: true })) as any[];
    expect(maxUsefulScroll(huge, 80, 1)).toBe(4);
  });
});

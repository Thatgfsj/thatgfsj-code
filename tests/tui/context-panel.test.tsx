// @vitest-environment node
/** @jsxImportSource react */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ContextPanel } from '../../src/tui/components/ContextPanel.js';

/**
 * v3.2.0: the right-side 上下文容量 panel (opencode parity, user-requested
 * from a screenshot). Numbers mirror the screenshot exactly: 33k/200k used
 * with a 61.4/22/7.3/5.1/4.2 share split and a 99% cache hit rate.
 */

const CATEGORIES = [
  { label: '系统工具', tokens: 20262 },
  { label: '消息', tokens: 7260 },
  { label: '技能', tokens: 2409 },
  { label: '系统提示词', tokens: 1683 },
  { label: 'MCP 工具', tokens: 1386 },
];

function toFrame(ui: { lastFrame: () => string | undefined }): string {
  return ui.lastFrame() || '';
}

describe('ContextPanel', () => {
  it('renders title, 万-format totals, percentage and the breakdown', () => {
    const frame = toFrame(render(
      <ContextPanel used={33000} window={200000} hitRate={0.99} categories={CATEGORIES} />
    ));
    expect(frame).toContain('上下文容量');
    expect(frame).toContain('3.3万/20万');
    expect(frame).toContain('16.5%');
    for (const label of ['系统工具', '消息', '技能', '系统提示词', 'MCP 工具', '其他']) {
      expect(frame).toContain(label);
    }
    expect(frame).toContain('61.4%'); // 系统工具 share of used
    expect(frame).toContain('7.3%');  // 技能
    expect(frame).toContain('平均缓存命中率');
    expect(frame).toContain('99%');
  });

  it('shows an em dash for the cache rate before the first completed round', () => {
    const frame = toFrame(render(
      <ContextPanel used={1000} window={128000} hitRate={null} categories={CATEGORIES} />
    ));
    expect(frame).toContain('—');
    expect(frame).toContain('1000/12.8万');
  });

  it('caps the bar at full when usage exceeds the window', () => {
    const frame = toFrame(render(
      <ContextPanel used={250000} window={200000} hitRate={0.5} categories={[]} />
    ));
    expect(frame).toContain('25万/20万');
    expect(frame).toContain('100%');
  });
});

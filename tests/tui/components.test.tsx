// @vitest-environment node
/** @jsxImportSource react */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Header } from '../../src/tui/components/Header.js';
import { StatusBar } from '../../src/tui/components/StatusBar.js';
import { ToolCall } from '../../src/tui/components/ToolCall.js';
import { ChatMessage } from '../../src/tui/components/ChatMessage.js';
import { Thinking } from '../../src/tui/components/Thinking.js';
import { ConfirmPrompt } from '../../src/tui/components/ConfirmPrompt.js';
import { Splash } from '../../src/tui/components/Splash.js';
import { UserInput } from '../../src/tui/components/UserInput.js';
import { mcpToolName } from '../../src/mcp/client.js';
import { getVersion } from '../../src/version.js';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

describe('TUI components (v3.0.6 opencode-style render)', () => {
  it('Header shows THATGFSJ brand + version from single source', () => {
    const { lastFrame } = render(<Header width={80} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('THATGFSJ');
    // version must come from package.json (single source), never hardcoded
    expect(frame).toContain(`v${getVersion()}`);
    expect(frame).toContain('─');
  });

  it('Header shows cache hit-rate chip when provided', () => {
    const { lastFrame } = render(<Header cacheHitRate={0.87} cacheSavingsCNY={0.42} cacheTtl="1h" width={80} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('87.0%');
    expect(frame).toContain('¥0.42');
    expect(frame).toContain('⏱ 1h');
  });

  it('StatusBar footer shows provider/model on the left, hints on the right', () => {
    const { lastFrame } = render(<StatusBar messageCount={12} skills={['tdd']} provider="siliconflow" model="deepseek-ai/DeepSeek-V4-Flash" />);
    const frame = lastFrame() || '';
    expect(frame).toContain('siliconflow');
    expect(frame).toContain('deepseek-ai/DeepSeek-V4-Flash');
    expect(frame).toContain('12 条');
    expect(frame).toContain('/help');
  });

  it('ToolCall renders compact ⎿ line with arg preview and result summary', () => {
    const { lastFrame } = render(
      <ToolCall
        tool={{ name: 'shell', args: '{"command":"npm test"}', result: 'line-a\nline-b\nline-c', isError: false }}
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('⎿');
    expect(frame).toContain('shell');
    expect(frame).toContain('npm test');
    expect(frame).toContain('3 行');
  });

  it('ToolCall shows error line in failed state', () => {
    const { lastFrame } = render(
      <ToolCall tool={{ name: 'file', args: '{"action":"read","path":"x.ts"}', result: 'EACCES: permission denied', isError: true }} />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('read');
    expect(frame).toContain('EACCES');
  });

  it('ChatMessage renders opencode session view (user bar + assistant label)', () => {
    const user = render(<ChatMessage message={{ role: 'user', content: '你好' }} />);
    expect(user.lastFrame() || '').toContain('你好');

    const assistant = render(<ChatMessage message={{ role: 'assistant', content: '答案' }} mode="Build" model="m1" />);
    const frame = assistant.lastFrame() || '';
    expect(frame).toContain('▪');
    expect(frame).toContain('Build · m1');
    expect(frame).toContain('答案');
  });

  it('Thinking renders spinner while active, nothing when idle', () => {
    const active = render(<Thinking active />);
    expect(active.lastFrame() || '').toContain('thinking');

    const idle = render(<Thinking active={false} />);
    expect(idle.lastFrame() || '').toBe('');
  });

  it('ConfirmPrompt dialog renders keys hint and diff colors markup', () => {
    const { lastFrame } = render(
      <ConfirmPrompt message={'修改文件: a.txt\n+ added\n- removed'} onAnswer={() => {}} />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('权限确认');
    expect(frame).toContain('+ added');
    expect(frame).toContain('[y] 允许');
    expect(frame).toContain('[a] 本会话全部允许');
  });

  it('MCP tool names stay provider-safe (used by ToolCall label)', () => {
    expect(mcpToolName('fs server', 'read/file')).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it('Splash renders the two-tone block logo (v3.0.8)', () => {
    const { lastFrame } = render(<Splash />);
    const frame = lastFrame() || '';
    expect(frame).toContain('███████');
    expect(frame).toContain('██████');
  });

  it('UserInput shows placeholder, info line and thinking chip (v3.0.8)', () => {
    const { lastFrame } = render(
      <UserInput
        onSubmit={() => {}}
        onCancel={() => {}}
        mode="Build"
        provider="siliconflow"
        model="Qwen/Qwen3.5-35B-A3B"
        thinking="low"
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('随便问点什么');
    expect(frame).toContain('Build');
    expect(frame).toContain('Qwen/Qwen3.5-35B-A3B');
    expect(frame).toContain('thinking:low');
    expect(frame).toContain('/models');
  });

  it('UserInput hides thinking chip when off (v3.0.8)', () => {
    const { lastFrame } = render(
      <UserInput onSubmit={() => {}} onCancel={() => {}} mode="Build" provider="p" model="m" thinking="off" />,
    );
    expect(lastFrame() || '').not.toContain('thinking');
  });

  it('version helper tracks package.json (single source, not hardcoded)', () => {
    const require = createRequire(import.meta.url);
    const path = require('node:path');
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    const pkg = require(pkgPath);
    expect(getVersion()).toBe(pkg.version);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

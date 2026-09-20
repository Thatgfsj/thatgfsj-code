/** @jsxImportSource react */
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { render } from 'ink-testing-library';
import { ModelSettings, resolveActivation } from '../../src/tui/components/ModelSettings.js';
import { BUILTIN_MODEL_ID } from '../../src/config/builtin.js';
import type { App } from '../../src/app/index.js';

/**
 * v3.4.4: /model /服务商 /models all open THIS single dialog. Contracts:
 *  - the list contains every provider's models + the builtin shared entry
 *  - ESC closes
 *  - a foreign-provider model without a key opens the inline key input
 *    (no separate wizard exists anymore)
 */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// isolate ~/.thatgfsj so models.json history can't shift the list indexes
let root: string;
let savedEnv: Record<string, string | undefined>;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gfcode-dialogs-'));
  savedEnv = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
  process.env.USERPROFILE = root;
  process.env.HOME = root;
});
afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function press(stdin: { write: (s: string) => void }, s: string) {
  stdin.write(s);
  await sleep(100);
}

/** Poll until the frame contains `text` (Ink renders async under load). */
async function waitFor(ui: { lastFrame: () => string | undefined }, text: string, ms = 3000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((ui.lastFrame() || '').includes(text)) return true;
    await sleep(50);
  }
  return false;
}

function stubApp(config: Record<string, unknown>): App {
  const state = { modelSettings: {}, customModels: [], apiKeys: {}, model: 'GLM-5.3-Flash', provider: 'zhipu', contextLength: 50, ...config };
  return {
    config: {
      get: () => ({ ...state }),
      save: async (u: Record<string, unknown>) => { Object.assign(state, u); },
    },
    listConfiguredModels: () => [state.model, ...(state.customModels as string[])],
    getContextWindow: () => 128000,
    getThinking: () => 'off',
    session: { getMaxMessages: () => 50 },
    switchModel: async () => {},
  } as unknown as App;
}

/** Poll until `fn` returns true (Ink stdin processing is async under load). */
async function until(fn: () => boolean, ms = 4000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await sleep(50);
  }
  return fn();
}

describe('ModelSettings (unified dialog)', () => {
  it('ESC closes the dialog', async () => {
    const onCancel = vi.fn();
    const ui = render(<ModelSettings app={stubApp({})} onClose={onCancel} />);
    await press(ui.stdin, '\x1B');
    expect(await until(() => onCancel.mock.calls.length >= 1)).toBe(true);
    ui.unmount();
  });

  it('lists ONLY the builtin model + user-added models (no provider catalogs)', async () => {
    const ui = render(
      <ModelSettings
        app={stubApp({ model: 'GLM-5.3-Flash', customModels: ['my-relay', 'GLM-5.3-Flash'], apiKeys: { deepseek: 'k' } })}
        onClose={() => {}}
        maxRows={60}
      />,
    );
    expect(await waitFor(ui, '内置共享')).toBe(true);
    const frame = ui.lastFrame() || '';
    expect(frame).toContain('GLM-5.3-Flash');      // current model
    expect(frame).toContain('my-relay');           // user-added id
    expect(frame).toContain('配置自己的服务商');     // add-provider entry
    // v3.4.9 mandate: NO provider catalogs at all — even providers with a
    // stored key must not flood the list
    expect(frame).not.toContain('deepseek/');
    expect(frame).not.toContain('kimi/');
    expect(frame).not.toContain('anthropic/');
    expect(frame).not.toContain('ollama/');
    // exactly one current marker (v3.4.6 duplicate-row regression)
    expect(frame.split('● 当前').length - 1).toBe(1);
    ui.unmount();
  });

  it('activation decisions are pure and correct (cross-provider key handling)', () => {
    // zhipu current, no keys anywhere: foreign model without key → inline prompt
    expect(resolveActivation({ provider: 'zhipu' }, false, { key: 'x', id: 'deepseek-flash', provider: 'deepseek' })).toBe('need-key');
    // …but with a stored/env key it switches straight away
    expect(resolveActivation({ provider: 'zhipu', apiKeys: { deepseek: 'k' } }, false, { key: 'x', id: 'deepseek-flash', provider: 'deepseek' })).toBe('switch-ready');
    expect(resolveActivation({ provider: 'zhipu' }, true, { key: 'x', id: 'deepseek-flash', provider: 'deepseek' })).toBe('switch-ready');
    // keyless provider is always ready
    expect(resolveActivation({ provider: 'zhipu' }, false, { key: 'x', id: 'qwen3.6', provider: 'ollama' })).toBe('switch-ready');
    // same provider / builtin / separators
    expect(resolveActivation({ provider: 'zhipu' }, false, { key: 'x', id: 'glm-5.2', provider: 'zhipu' })).toBe('same-provider');
    expect(resolveActivation({ provider: 'zhipu' }, false, { key: 'x', id: BUILTIN_MODEL_ID, provider: 'siliconflow', builtin: true })).toBe('builtin');
    expect(resolveActivation({ provider: 'zhipu' }, false, { key: 'x', sep: '── x ──' })).toBe('noop');
  });
});

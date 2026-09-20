/** @jsxImportSource react */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ModelSelector } from '../../src/tui/components/ModelSelector.js';
import { InitWizard } from '../../src/tui/components/InitWizard.js';

/**
 * v3.4.2 dialog contracts:
 *  - ModelSelector: list only contains models of the current provider
 *    (no cross-provider history mixing) and ESC cancels — previously there
 *    was NO way out of the picker without picking a model.
 *  - InitWizard: ESC cancels from the very first (select) step, and a
 *    keyless provider (Ollama) skips the API-key step.
 */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function press(stdin: { write: (s: string) => void }, s: string) {
  stdin.write(s);
  await sleep(60);
}

describe('ModelSelector', () => {
  it('ESC cancels without forcing a selection', async () => {
    const onCancel = vi.fn();
    const onSelect = vi.fn();
    const ui = render(
      <ModelSelector
        currentModel="glm-5.2"
        currentProvider="zhipu"
        onSelect={onSelect}
        onAddNew={() => {}}
        onCancel={onCancel}
      />,
    );
    await press(ui.stdin, '\x1B');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    ui.unmount();
  });

  it('list is provider-scoped: no foreign history entries', async () => {
    const ui = render(
      <ModelSelector
        currentModel="glm-5.2"
        currentProvider="zhipu"
        customModels={['my-relay-model']}
        onSelect={() => {}}
        onAddNew={() => {}}
        onCancel={() => {}}
      />,
    );
    await sleep(50);
    const frame = ui.lastFrame() || '';
    // zhipu catalog is present…
    expect(frame).toContain('glm-5.3');
    // …builtin shared model (siliconflow-only) and other providers are not.
    expect(frame).not.toContain('内置共享');
    expect(frame).not.toContain('kimi-k2.6');
    expect(frame).not.toContain('gpt-5.4-mini');
    ui.unmount();
  });
});

describe('InitWizard', () => {
  it('ESC cancels from the first (provider select) step', async () => {
    const onCancel = vi.fn();
    const ui = render(<InitWizard onComplete={() => {}} onCancel={onCancel} />);
    await press(ui.stdin, '\x1B');
    expect(onCancel).toHaveBeenCalledTimes(1);
    ui.unmount();
  });

  it('ollama skips the API-key step', async () => {
    const onComplete = vi.fn();
    const ui = render(<InitWizard onComplete={onComplete} onCancel={() => {}} />);
    await sleep(50);
    // navigate to Ollama and confirm
    for (let i = 0; i < 11; i++) await press(ui.stdin, '\x1b[B'); // ↓ through the list
    await press(ui.stdin, '\r');
    await sleep(50);
    // should now be on the model step, NOT the key step
    expect(ui.lastFrame() || '').toContain('选择模型');
    ui.unmount();
  });
});

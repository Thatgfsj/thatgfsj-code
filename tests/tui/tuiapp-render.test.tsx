// @vitest-environment node
/** @jsxImportSource react */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { TuiApp } from '../../src/tui/app.js';
import type { App } from '../../src/app/index.js';

/**
 * Full-app render smoke test: mounts the REAL TuiApp (splash branch) so
 * upstream runtime breakage in ink/react minors surfaces in CI instead of
 * on user machines (the 3.1.0 "reading 'items'" crash class).
 */

function stubApp(overrides: Record<string, unknown> = {}): App {
  return {
    config: {
      get: () => ({ model: 'm1', provider: 'siliconflow' }),
      save: async () => {},
      hasApiKey: () => true,
    },
    session: {
      addMessage: () => {},
      persist: () => {},
      reset: () => {},
    },
    cacheStats: {
      snapshot: () => ({
        totalRequests: 0, totalInputTokens: 0, totalReadTokens: 0,
        totalCreationTokens: 0, hitRate: 0, estimatedSavingsCNY: 0, history: [],
      }),
    },
    permissionMode: 'ask',
    sessionStats: { promptTokens: 0, completionTokens: 0, rounds: 0 },
    showThinking: false,
    getThinking: () => 'off',
    getContextWindow: () => 128000,
    // v3.6.0: sidebar fallback goes through the live estimator.
    currentContextEstimate: () => 1234,
    skills: { listActive: () => [] },
    requestConfirmation: async () => true,
    reloadModel: async () => {},
    setYolo: () => {},
    setPlanMode: () => {},
    setFullPermission: () => {},
    maybeAutoCompact: () => null,
    ...overrides,
  } as unknown as App;
}

describe('TuiApp render smoke (upstream-breakage canary)', () => {
  it('renders the splash screen without crashing', async () => {
    const instance = render(<TuiApp app={stubApp()} />);
    await new Promise(r => setTimeout(r, 120));
    const frame = instance.lastFrame();
    // Logo is figlet box-drawing art (no literal "THATGFSJ" text) — assert
    // on the input placeholder + status line instead.
    expect(frame).toContain('随便问点什么');
    expect(frame).toContain('Build · m1');
    instance.unmount();
  });

  it('renders in plan mode with the blue badge', async () => {
    const instance = render(<TuiApp app={stubApp({ permissionMode: 'plan' })} />);
    await new Promise(r => setTimeout(r, 120));
    expect(instance.lastFrame()).toContain('计划模式');
    instance.unmount();
  });

  it('renders in full-permission mode with the red badge', async () => {
    const instance = render(<TuiApp app={stubApp({ permissionMode: 'accept' })} />);
    await new Promise(r => setTimeout(r, 120));
    expect(instance.lastFrame()).toContain('完整权限模式');
    instance.unmount();
  });
});

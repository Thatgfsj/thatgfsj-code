// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../../src/utils/tokens.js';
import { ContextCompactor } from '../../src/session/compactor.js';
import { SessionManager } from '../../src/session/index.js';
import { MODEL_CONTEXT_WINDOWS } from '../../src/config/providers.js';
import type { ChatMessage } from '../../src/types.js';

/**
 * v3.6.0 context-calculation regressions (field-report findings).
 */

describe('estimateTokens recalibration', () => {
  it('Chinese: between 0.6 and 0.9 tokens/char (was 1.0 → 1.66x overestimate)', () => {
    const text = '这是一段用于测试的中文文本，包含常见的汉字与标点。'.repeat(20);
    const per = estimateTokens(text) / text.length;
    expect(per).toBeGreaterThanOrEqual(0.6);
    expect(per).toBeLessThanOrEqual(0.9);
  });

  it('English/JSON: between 0.2 and 0.35 tokens/char (was 0.25 → fine, tighter bound)', () => {
    const text = '{"action":"write","path":"src/module/activationEngine.ts","content":"export function spread() { return nodes; }"}'.repeat(20);
    const per = estimateTokens(text) / text.length;
    expect(per).toBeGreaterThan(0.2);
    expect(per).toBeLessThanOrEqual(0.35);
  });

  it('never returns 0 for non-empty text', () => {
    expect(estimateTokens('x')).toBeGreaterThan(0);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('compactor tokenPressure (P0-1: token compaction was dead code)', () => {
  const msgs = (n: number): ChatMessage[] => {
    const out: ChatMessage[] = [{ role: 'system', content: 'sys' }];
    for (let i = 0; i < n; i++) {
      out.push({ role: 'user', content: `msg ${i}` });
      out.push({ role: 'assistant', content: `reply ${i}` });
    }
    return out;
  };

  it('without tokenPressure the message-count gate still refuses (message window semantics)', () => {
    const c = new ContextCompactor({ maxMessages: 100 });
    const r = c.compact(msgs(20)); // 41 messages <= 100
    expect(r.result.removedCount).toBe(0);
  });

  it('with tokenPressure it compacts even under the message limit', () => {
    const c = new ContextCompactor({ maxMessages: 100, preserveRecent: 6 });
    const r = c.compact(msgs(20), { tokenPressure: true });
    expect(r.result.removedCount).toBeGreaterThan(0);
  });

  it('tokenPressure with nothing compressible returns unchanged', () => {
    const c = new ContextCompactor({ maxMessages: 100 });
    const single = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }] as ChatMessage[];
    const r = c.compact(single, { tokenPressure: true });
    expect(r.result.removedCount).toBe(0);
  });
});

describe('SessionManager window clamping (P2-11)', () => {
  it('constructor clamps hand-edited extremes', () => {
    expect(SessionManager.clampMaxMessages(0)).toBe(5);
    expect(SessionManager.clampMaxMessages(-10)).toBe(5);
    expect(SessionManager.clampMaxMessages(99999)).toBe(1000);
    expect(SessionManager.clampMaxMessages(50)).toBe(50);
  });

  it('new SessionManager(0) is clamped to 5, not 0', () => {
    const s = new SessionManager(0);
    for (let i = 0; i < 12; i++) s.addMessage('user', `m${i}`);
    // With max 0 the auto-compact could never group-sanely compress; with 5
    // the window stays bounded.
    expect(s.getMessageCount()).toBeLessThanOrEqual(12);
    expect(s.getMaxMessages()).toBe(5);
  });
});

describe('MODEL_CONTEXT_WINDOWS metadata (P1-4)', () => {
  it('builtin shared model is 262,144, not the 128k guess', () => {
    expect(MODEL_CONTEXT_WINDOWS['Qwen/Qwen3.5-4B']).toBe(262144);
  });
  it('small-window catalog models are listed', () => {
    expect(MODEL_CONTEXT_WINDOWS['step-1-8k']).toBe(8192);
    expect(MODEL_CONTEXT_WINDOWS['doubao-1.5-pro-32k']).toBe(32768);
  });
  it('unknown models are absent (fall through to config default)', () => {
    expect(MODEL_CONTEXT_WINDOWS['some/unknown-model']).toBeUndefined();
  });
});

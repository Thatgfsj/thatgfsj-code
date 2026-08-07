import { describe, it, expect } from 'vitest';
import { VolatileScratch } from '../../src/cache/volatile.js';

describe('VolatileScratch', () => {
  it('starts empty', () => {
    const s = new VolatileScratch();
    expect(s.isEmpty()).toBe(true);
    expect(s.read()).toBe('');
    expect(s.size()).toBe(0);
  });

  it('accumulates writes separated by newlines', () => {
    const s = new VolatileScratch();
    s.write('first thought');
    s.write('second thought');
    expect(s.read()).toBe('first thought\nsecond thought');
    expect(s.size()).toBe(2);
    expect(s.isEmpty()).toBe(false);
  });

  it('ignores empty writes', () => {
    const s = new VolatileScratch();
    s.write('');
    s.write('real content');
    s.write('');
    expect(s.size()).toBe(1);
    expect(s.read()).toBe('real content');
  });

  it('reset() clears everything', () => {
    const s = new VolatileScratch();
    s.write('a');
    s.write('b');
    s.reset();
    expect(s.isEmpty()).toBe(true);
    expect(s.read()).toBe('');
    expect(s.size()).toBe(0);
  });

  it('multiple reset() cycles are independent', () => {
    const s = new VolatileScratch();
    s.write('cycle 1');
    s.reset();
    s.write('cycle 2');
    expect(s.read()).toBe('cycle 2');
    s.reset();
    expect(s.read()).toBe('');
  });
});

describe('shouldDowngrade (smartModel)', () => {
  it('returns false when prompt is long', async () => {
    const { shouldDowngrade } = await import('../../src/cache/smartModel.js');
    const decision = shouldDowngrade([], 'x'.repeat(500));
    expect(decision.downgrade).toBe(false);
    expect(decision.reason).toBe('prompt-too-long');
  });

  it('returns false when recent messages had tool_calls', async () => {
    const { shouldDowngrade } = await import('../../src/cache/smartModel.js');
    const messages = [
      { role: 'assistant' as const, content: '...', tool_calls: [{ id: '1', type: 'function' as const, function: { name: 'file', arguments: '{}' } }] },
    ];
    const decision = shouldDowngrade(messages, 'short prompt');
    expect(decision.downgrade).toBe(false);
    expect(decision.reason).toBe('recent-tool-call');
  });

  it('returns true for short prompt with no recent tool activity', async () => {
    const { shouldDowngrade } = await import('../../src/cache/smartModel.js');
    const decision = shouldDowngrade([], 'thanks!');
    expect(decision.downgrade).toBe(true);
    expect(decision.reason).toBe('short-no-tools');
  });
});

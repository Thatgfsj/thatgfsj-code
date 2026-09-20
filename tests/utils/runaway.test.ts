// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createRunawayGuard } from '../../src/utils/runaway.js';

describe('runaway guard (v3.3.0, idea from MiniMax mcode)', () => {
  it('counts repeats per identical (tool,args) fingerprint', () => {
    const g = createRunawayGuard();
    expect(g.track('shell', '{"cmd":"npm test"}')).toEqual({ count: 1, remind: false });
    expect(g.track('shell', '{"cmd":"npm test"}')).toEqual({ count: 2, remind: false });
    expect(g.track('shell', '{"cmd":"npm test"}')).toEqual({ count: 3, remind: true });
  });

  it('different args are different fingerprints', () => {
    const g = createRunawayGuard();
    g.track('shell', '{"cmd":"a"}');
    g.track('shell', '{"cmd":"b"}');
    const v = g.track('shell', '{"cmd":"a"}');
    expect(v.count).toBe(2);
    expect(v.remind).toBe(false);
  });

  it('reminds every 3rd repeat and resets per turn', () => {
    const g = createRunawayGuard();
    for (let i = 1; i <= 6; i++) {
      const v = g.track('browser', '{"url":"https://x"}');
      expect(v.remind).toBe(i === 3 || i === 6);
    }
    g.reset();
    expect(g.track('browser', '{"url":"https://x"}').count).toBe(1);
  });
});

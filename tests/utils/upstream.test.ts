import { describe, it, expect } from 'vitest';
import { extractUpstreamMessage } from '../../src/utils/upstream.js';

describe('extractUpstreamMessage', () => {
  it('pulls the provider message out of a folded error body (zhipu 1113)', () => {
    const raw = 'API error 429: {"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}';
    expect(extractUpstreamMessage(raw)).toContain('余额不足');
  });

  it('handles top-level message shapes and quoted fallbacks', () => {
    expect(extractUpstreamMessage('API error 400: {"message":"bad model"}')).toBe('bad model');
    expect(extractUpstreamMessage('boom "message":"quota exhausted" done')).toBe('quota exhausted');
  });

  it('returns empty when there is nothing human-readable', () => {
    expect(extractUpstreamMessage('fetch failed (ECONNRESET)')).toBe('');
  });
});

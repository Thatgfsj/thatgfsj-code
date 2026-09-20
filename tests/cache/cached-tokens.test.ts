import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { CacheStatsStore } from '../../src/cache/stats.js';

describe('cache stats: OpenAI-compatible cached_tokens (v3.4.10)', () => {
  it('counts cached_tokens as read — zhipu/SiliconFlow hits were recorded as 0 before', () => {
    const store = new CacheStatsStore(join(mkdtempSync(join(tmpdir(), 'gfcache-')), 'cache-stats.json'));
    store.record({ prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010, cached_tokens: 900 });
    const s = store.snapshot();
    expect(s.totalReadTokens).toBe(900);
    expect(s.hitRate).toBeCloseTo(0.9);
  });

  it('DeepSeek and Anthropic shapes still work', () => {
    const store = new CacheStatsStore(join(mkdtempSync(join(tmpdir(), 'gfcache-')), 'cache-stats.json'));
    store.record({ prompt_tokens: 500, completion_tokens: 5, total_tokens: 505, prompt_cache_hit_tokens: 400 });
    store.record({ prompt_tokens: 800, completion_tokens: 5, total_tokens: 805, cache_read_input_tokens: 700, cache_creation_input_tokens: 50 });
    const s = store.snapshot();
    expect(s.totalReadTokens).toBe(1100);
  });

  it('a provider reporting nothing still counts the round', () => {
    const store = new CacheStatsStore(join(mkdtempSync(join(tmpdir(), 'gfcache-')), 'cache-stats.json'));
    store.record({ prompt_tokens: 100, completion_tokens: 1, total_tokens: 101 });
    expect(store.snapshot().totalRequests).toBe(1);
  });
});

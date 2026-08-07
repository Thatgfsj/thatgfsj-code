import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CacheStatsStore, estimateSavingsCNY } from '../../src/cache/stats.js';
import type { Usage } from '../../src/types.js';

let tmpDir: string;
let statsPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'cache-stats-'));
  statsPath = join(tmpDir, 'cache-stats.json');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('CacheStatsStore', () => {
  it('starts empty when no file exists', () => {
    const store = new CacheStatsStore(statsPath);
    const s = store.snapshot();
    expect(s.totalRequests).toBe(0);
    expect(s.totalReadTokens).toBe(0);
    expect(s.totalCreationTokens).toBe(0);
    expect(s.totalInputTokens).toBe(0);
    expect(s.hitRate).toBe(0);
    expect(s.estimatedSavingsCNY).toBe(0);
    expect(s.history).toEqual([]);
  });

  it('records Anthropic usage (cache_read / cache_creation)', () => {
    const store = new CacheStatsStore(statsPath);
    const usage: Usage = {
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      cache_creation_input_tokens: 800,
      cache_read_input_tokens: 100,
    };
    store.record(usage);

    const s = store.snapshot();
    expect(s.totalRequests).toBe(1);
    expect(s.totalReadTokens).toBe(100);
    expect(s.totalCreationTokens).toBe(800);
    expect(s.totalInputTokens).toBe(1000);
    expect(s.totalOutputTokens).toBe(200);
    expect(s.hitRate).toBeCloseTo(0.1, 5); // 100 / 1000
    expect(s.history.length).toBe(1);
    expect(s.history[0].read).toBe(100);
  });

  it('records DeepSeek usage (prompt_cache_hit / miss)', () => {
    const store = new CacheStatsStore(statsPath);
    const usage: Usage = {
      prompt_tokens: 5000,
      completion_tokens: 800,
      total_tokens: 5800,
      prompt_cache_hit_tokens: 4000,
      prompt_cache_miss_tokens: 1000,
    };
    store.record(usage);

    const s = store.snapshot();
    expect(s.totalReadTokens).toBe(4000); // hit → read
    expect(s.totalCreationTokens).toBe(1000); // miss → creation
    expect(s.hitRate).toBeCloseTo(0.8, 5); // 4000 / 5000
  });

  it('persists across instances', () => {
    const a = new CacheStatsStore(statsPath);
    a.record({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_read_input_tokens: 80,
    });
    expect(existsSync(statsPath)).toBe(true);

    const b = new CacheStatsStore(statsPath);
    const s = b.snapshot();
    expect(s.totalRequests).toBe(1);
    expect(s.totalReadTokens).toBe(80);
  });

  it('reset() clears all stats', () => {
    const store = new CacheStatsStore(statsPath);
    store.record({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_read_input_tokens: 80,
    });
    expect(store.snapshot().totalRequests).toBe(1);

    store.reset();
    const s = store.snapshot();
    expect(s.totalRequests).toBe(0);
    expect(s.totalReadTokens).toBe(0);
    expect(s.history).toEqual([]);
  });

  it('history rolls over after HISTORY_LIMIT rounds', () => {
    const store = new CacheStatsStore(statsPath);
    for (let i = 0; i < 60; i++) {
      store.record({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cache_read_input_tokens: 10,
      });
    }
    // Internal HISTORY_LIMIT is 50; the array should be capped.
    expect(store.snapshot().history.length).toBeLessThanOrEqual(50);
    expect(store.snapshot().totalRequests).toBe(60); // totals not capped
  });
});

describe('estimateSavingsCNY', () => {
  it('returns 0 when nothing cached', () => {
    expect(estimateSavingsCNY({
      totalReadTokens: 0,
      totalCreationTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRequests: 0,
      history: [],
    })).toBe(0);
  });

  it('returns positive for cached tokens', () => {
    // 1M tokens cached at 10x saving ≈ ¥2.7
    const v = estimateSavingsCNY({
      totalReadTokens: 1_000_000,
      totalCreationTokens: 0,
      totalInputTokens: 1_000_000,
      totalOutputTokens: 0,
      totalRequests: 1,
      history: [],
    });
    expect(v).toBeGreaterThan(2);
    expect(v).toBeLessThan(3.5);
  });
});

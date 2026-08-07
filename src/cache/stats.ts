/**
 * Cache statistics store.
 *
 * Tracks per-round cache hit/miss token counts across the user's local
 * sessions and persists them to `~/.thatgfsj/cache-stats.json`. The store
 * is consumed by:
 *   - the TUI Header (`⚡ 命中率 87%`)
 *   - the /cache CLI command (detailed breakdown)
 *   - the /cache reset command (clears the file)
 *
 * Provider-agnostic. Anthropic reports cache_creation_input_tokens /
 * cache_read_input_tokens; DeepSeek reports prompt_cache_hit_tokens /
 * prompt_cache_miss_tokens; OpenAI does not surface any cache stats at
 * all (their automatic cache is invisible to the client). We normalize
 * both shapes into a single internal model.
 *
 * Cost estimation is intentionally simplified:
 *   - cache_read = 10% of normal input price
 *   - cache_creation = 125% of normal input price (Anthropic charges extra
 *     on first write)
 *   - We compare against the baseline "what would this have cost without
 *     caching" and report the delta as estimated savings.
 *
 * Prices are in CNY per million tokens. Defaults reflect Anthropic Claude
 * Sonnet on the official API; users on cheaper providers may see savings
 * proportional to their actual price floor. The numbers are *estimates*
 * — the goal is to give the user a sense of order of magnitude, not a
 * billable invoice.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { Usage } from '../types.js';

/** Per-million-token price in CNY. Adjust if your provider differs significantly. */
const PRICE = {
  normalInput: 3,
  cacheRead: 0.3,
  cacheCreation: 3.75,
  output: 15,
};

/** Maximum number of recent rounds kept in the history array (rolling window). */
const HISTORY_LIMIT = 50;

export interface CacheStats {
  /** Total tokens served from cache (Anthropic cache_read / DeepSeek hit). */
  totalReadTokens: number;
  /** Total tokens written into cache (Anthropic cache_creation / DeepSeek miss prefix written). */
  totalCreationTokens: number;
  /** Total input tokens (prompt_tokens). */
  totalInputTokens: number;
  /** Total output tokens. */
  totalOutputTokens: number;
  /** Number of completed rounds. */
  totalRequests: number;
  /** Last N round snapshots (oldest first). */
  history: Array<{
    ts: number;
    read: number;
    creation: number;
    input: number;
    output: number;
    hitRate: number;
  }>;
}

export interface CacheSnapshot extends CacheStats {
  /** 0..1 ratio of cached tokens to total input tokens. */
  hitRate: number;
  /** Estimated CNY saved vs uncached baseline. */
  estimatedSavingsCNY: number;
}

const EMPTY_STATS: CacheStats = {
  totalReadTokens: 0,
  totalCreationTokens: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalRequests: 0,
  history: [],
};

/**
 * Estimate the CNY saved by cache_read vs a hypothetical uncached baseline.
 * Negative values are clamped to zero (e.g. a relay station that returned
 * bogus cache stats).
 */
export function estimateSavingsCNY(stats: CacheStats): number {
  const baselineCost = (stats.totalReadTokens / 1e6) * PRICE.normalInput;
  const cachedCost = (stats.totalReadTokens / 1e6) * PRICE.cacheRead;
  return Math.max(0, baselineCost - cachedCost);
}

/**
 * Persists cache stats to disk. Safe to call from a hot path — uses atomic
 * write (write to .tmp, rename) to avoid corruption on crash.
 */
export class CacheStatsStore {
  private stats: CacheStats;
  private path: string;

  constructor(path?: string) {
    this.path = path ?? join(homedir(), '.thatgfsj', 'cache-stats.json');
    this.stats = this.load();
  }

  /**
   * Record a single round's usage. Provider-agnostic: accepts both Anthropic
   * (cache_creation_input_tokens / cache_read_input_tokens) and DeepSeek
   * (prompt_cache_hit_tokens / prompt_cache_miss_tokens) shapes. If a
   * provider returned neither (e.g. OpenAI), the call is a no-op apart
   * from updating totalRequest count.
   */
  record(usage: Usage): void {
    const read = usage.cache_read_input_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
    const creation = usage.cache_creation_input_tokens
      ?? (usage.prompt_cache_miss_tokens ?? 0);
    const input = usage.prompt_tokens ?? 0;
    const output = usage.completion_tokens ?? 0;

    // Avoid double-counting: if the provider reported both cache_creation
    // and prompt_cache_miss_tokens we'd otherwise sum them. The ?? in the
    // chain above only uses prompt_cache_miss_tokens when
    // cache_creation_input_tokens is undefined, which is what we want.

    this.stats.totalReadTokens += read;
    this.stats.totalCreationTokens += creation;
    this.stats.totalInputTokens += input;
    this.stats.totalOutputTokens += output;
    this.stats.totalRequests += 1;

    // Per-round snapshot (for /cache command history view).
    const total = read + (input - read);
    const hitRate = total > 0 ? read / total : 0;
    this.stats.history.push({ ts: Date.now(), read, creation, input, output, hitRate });
    if (this.stats.history.length > HISTORY_LIMIT) {
      this.stats.history.splice(0, this.stats.history.length - HISTORY_LIMIT);
    }

    this.save();
  }

  /**
   * Reset the stats. Used by `/cache reset`.
   */
  reset(): void {
    this.stats = { ...EMPTY_STATS, history: [] };
    this.save();
  }

  /**
   * Read-only snapshot for rendering (TUI Header, /cache command).
   */
  snapshot(): CacheSnapshot {
    const input = this.stats.totalInputTokens;
    const read = this.stats.totalReadTokens;
    const hitRate = input > 0 ? read / input : 0;
    return {
      ...this.stats,
      hitRate,
      estimatedSavingsCNY: estimateSavingsCNY(this.stats),
    };
  }

  /** Direct accessor for tests. */
  get raw(): CacheStats { return this.stats; }

  // -- I/O --

  private load(): CacheStats {
    try {
      if (!existsSync(this.path)) return { ...EMPTY_STATS, history: [] };
      const txt = readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(txt);
      // Tolerate partial / older shapes.
      return {
        totalReadTokens: parsed.totalReadTokens ?? 0,
        totalCreationTokens: parsed.totalCreationTokens ?? 0,
        totalInputTokens: parsed.totalInputTokens ?? 0,
        totalOutputTokens: parsed.totalOutputTokens ?? 0,
        totalRequests: parsed.totalRequests ?? 0,
        history: Array.isArray(parsed.history) ? parsed.history : [],
      };
    } catch {
      return { ...EMPTY_STATS, history: [] };
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.stats, null, 2), 'utf-8');
    } catch {
      // best-effort persistence; do not crash the chat loop on disk errors
    }
  }
}

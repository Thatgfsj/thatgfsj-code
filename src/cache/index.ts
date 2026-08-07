/**
 * Cache subsystem barrel. Re-exports the public surface used by the TUI,
 * the App singleton, and the LLM service.
 *
 * Modules:
 *   - fingerprint.ts: stable hashes for tools + immutable system prefix
 *   - stats.ts:       CacheStatsStore — per-round hit/miss + cost savings
 *   - volatile.ts:    VolatileScratch — per-round scratch that never reaches the API
 *   - smartModel.ts:  smart-model routing hook (simple → mini, complex → main)
 */

export { fingerprint, fingerprintTools, fingerprintSystemPrefix } from './fingerprint.js';
export { CacheStatsStore, estimateSavingsCNY, type CacheStats, type CacheSnapshot } from './stats.js';
export { VolatileScratch } from './volatile.js';
export { shouldDowngrade, type SmartModelDecision } from './smartModel.js';

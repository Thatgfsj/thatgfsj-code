import { describe, it, expect } from 'vitest';
import { getModelsForProvider, PROVIDERS } from '../../src/config/providers.js';

describe('ModelSelector catalog integration', () => {
  it('deepseek provider has current 2026-09 models (deepseek-chat retired)', () => {
    const models = getModelsForProvider('deepseek');
    const ids = models.map(m => m.id);
    expect(ids).toContain('deepseek-flash');
    expect(ids).toContain('deepseek-v4-pro');
    expect(ids).not.toContain('deepseek-chat'); // retired 2026-07-24
  });

  it('siliconflow provider has current Qwen3.5 models', () => {
    const models = getModelsForProvider('siliconflow');
    const ids = models.map(m => m.id);
    expect(ids).toContain('Qwen/Qwen3.5-35B-A3B');
  });

  it('custom_openai provider has gpt-5.4-mini fallback', () => {
    const models = getModelsForProvider('custom_openai');
    const ids = models.map(m => m.id);
    expect(ids).toContain('gpt-5.4-mini');
  });

  it('all known providers have a non-empty catalog', () => {
    const knownProviders = Object.keys(PROVIDERS);
    for (const p of knownProviders) {
      const models = getModelsForProvider(p as any);
      expect(models.length, `provider ${p} should have at least one model`).toBeGreaterThan(0);
    }
  });
});

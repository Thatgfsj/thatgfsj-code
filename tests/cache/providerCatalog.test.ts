import { describe, it, expect } from 'vitest';
import { getModelsForProvider, PROVIDERS } from '../../src/config/providers.js';

describe('ModelSelector catalog integration', () => {
  it('deepseek provider has deepseek-chat and deepseek-reasoner', () => {
    const models = getModelsForProvider('deepseek');
    const ids = models.map(m => m.id);
    expect(ids).toContain('deepseek-chat');
    expect(ids).toContain('deepseek-reasoner');
  });

  it('siliconflow provider has Qwen models', () => {
    const models = getModelsForProvider('siliconflow');
    const ids = models.map(m => m.id);
    expect(ids).toContain('Qwen/Qwen2.5-7B-Instruct');
  });

  it('custom_openai provider has gpt-4o fallback', () => {
    const models = getModelsForProvider('custom_openai');
    const ids = models.map(m => m.id);
    expect(ids).toContain('gpt-4o');
  });

  it('all known providers have a non-empty catalog', () => {
    const knownProviders = Object.keys(PROVIDERS);
    for (const p of knownProviders) {
      const models = getModelsForProvider(p as any);
      expect(models.length, `provider ${p} should have at least one model`).toBeGreaterThan(0);
    }
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigManager } from '../../src/config/index.js';
import { effectiveContextLength } from '../../src/app/index.js';
import { historyForProvider, recordModelUse, loadModelHistory } from '../../src/config/modelHistory.js';
import type { Config } from '../../src/config/types.js';

/**
 * v3.4.2 regression tests for the model-settings repair pass:
 *  - keyless providers must NOT fall back to the built-in shared model
 *  - per-provider API keys (no cross-provider reuse), env priority, legacy migration
 *  - hand-edited config sanitization (customModels string, bad modelSettings, bad ttl)
 *  - per-model contextLength consumed at "startup" (effectiveContextLength)
 *  - provider-tagged models.json history
 */

let root: string;
let savedEnv: Record<string, string | undefined>;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gfcode-modelcfg-'));
  mkdirSync(join(root, '.thatgfsj'), { recursive: true });
  savedEnv = {
    USERPROFILE: process.env.USERPROFILE,
    HOME: process.env.HOME,
    MODEL: process.env.MODEL,
    SILICONFLOW_API_KEY: process.env.SILICONFLOW_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    CUSTOM_BASE_URL: process.env.CUSTOM_BASE_URL,
  };
  process.env.USERPROFILE = root;
  process.env.HOME = root;
  delete process.env.MODEL;
  for (const k of ['SILICONFLOW_API_KEY', 'DEEPSEEK_API_KEY', 'CUSTOM_BASE_URL']) delete process.env[k];
});

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function loadWith(fileConfig: Record<string, unknown>): Promise<ConfigManager> {
  writeFileSync(join(root, '.thatgfsj', 'config.json'), JSON.stringify(fileConfig), 'utf-8');
  return ConfigManager.load();
}

describe('keyless providers (ollama)', () => {
  it('does NOT fall back to the built-in shared cloud model', async () => {
    const cm = await loadWith({ provider: 'ollama', model: 'qwen3.6', apiKey: 'dummy' });
    const ai = cm.getAIConfig();
    expect(ai.provider).toBe('ollama');
    expect(ai.model).toBe('qwen3.6');
    expect(ai.baseUrl).toBe('http://localhost:11434/v1');
    expect(ai.usingBuiltinKey).toBeFalsy();
    expect(ai.apiKey).toBe('');
  });

  it('hasApiKey() is true for a keyless provider with no key', async () => {
    const cm = await loadWith({ provider: 'ollama', model: 'gpt-oss:20b' });
    expect(cm.hasApiKey()).toBe(true);
  });
});

describe('per-provider API keys', () => {
  it('switching provider later does NOT reuse the stored key of the old provider', async () => {
    const cm = await loadWith({ provider: 'siliconflow', model: 'Qwen/Qwen3.5-4B', apiKey: 'sk-sf-key' });
    expect(cm.get().apiKey).toBe('sk-sf-key');
    // Switch to deepseek (no key stored for deepseek, no env): the old
    // resolveProvider sent sk-sf-key to DeepSeek; now it resolves to ''.
    await cm.save({ provider: 'deepseek', model: 'deepseek-flash' });
    expect(cm.get().apiKey).toBe('');
    // apiKeys is non-empty → explicit setup → NO silent builtin hijack; the
    // request really goes to deepseek (and fails with an honest 401).
    expect(cm.getAIConfig().usingBuiltinKey).toBeFalsy();
    expect(cm.getAIConfig().provider).toBe('deepseek');
    // Switching back re-finds the siliconflow key.
    await cm.save({ provider: 'siliconflow', model: 'Qwen/Qwen3.5-4B' });
    expect(cm.get().apiKey).toBe('sk-sf-key');
  });

  it('migrates a legacy key to its own provider and still uses it', async () => {
    const cm = await loadWith({ provider: 'siliconflow', model: 'Qwen/Qwen3.5-4B', apiKey: 'sk-mine' });
    expect(cm.get().apiKey).toBe('sk-mine');
    expect(cm.get().apiKeys?.siliconflow).toBe('sk-mine');
    expect(cm.getAIConfig().usingBuiltinKey).toBeFalsy();
  });

  it('prefers the env key over the stored key (consistent with model resolution)', async () => {
    process.env.SILICONFLOW_API_KEY = 'sk-env';
    try {
      const cm = await loadWith({ provider: 'siliconflow', apiKey: 'sk-stored' });
      expect(cm.get().apiKey).toBe('sk-env');
    } finally {
      delete process.env.SILICONFLOW_API_KEY;
    }
  });

  it('saving an apiKey records it under the current provider', async () => {
    const cm = await loadWith({ provider: 'deepseek', apiKey: '' });
    await cm.save({ apiKey: 'sk-ds' });
    expect(cm.get().apiKeys?.deepseek).toBe('sk-ds');
    // persisted
    const cm2 = await ConfigManager.load();
    expect(cm2.get().apiKeys?.deepseek).toBe('sk-ds');
  });
});

describe('hand-edited config sanitization', () => {
  it('customModels as a string does NOT explode into single characters', async () => {
    const cm = await loadWith({ provider: 'siliconflow', apiKey: 'k', customModels: 'glm-5.3' });
    expect(cm.get().customModels).toEqual(['glm-5.3']);
  });

  it('customModels non-string items are dropped, not persisted back', async () => {
    const cm = await loadWith({ provider: 'siliconflow', apiKey: 'k', customModels: ['ok-model', 42, null] });
    expect(cm.get().customModels).toEqual(['ok-model']);
    await cm.save({ model: 'Qwen/Qwen3.5-4B' });
    const raw = JSON.parse(readFileSync(join(root, '.thatgfsj', 'config.json'), 'utf-8'));
    expect(raw.customModels).toEqual(['ok-model']);
  });

  it('modelSettings of the wrong type falls back to {} with a warning', async () => {
    const cm = await loadWith({ provider: 'siliconflow', apiKey: 'k', modelSettings: 'oops' });
    expect(cm.get().modelSettings).toEqual({});
  });

  it('an invalid cache.ttl falls back to 1h instead of silently disabling TTL', async () => {
    const cm = await loadWith({ provider: 'siliconflow', apiKey: 'k', cache: { enabled: true, ttl: 12345 } });
    expect(cm.get().cache?.ttl).toBe('1h');
  });
});

describe('builtin fallback scoping', () => {
  it('a truly fresh config still falls back to the builtin shared model', async () => {
    const cm = await loadWith({});
    expect(cm.getAIConfig().usingBuiltinKey).toBeTruthy();
    expect(cm.getAIConfig().provider).toBe('siliconflow');
  });

  it('explicit setup (custom model / customModels / any stored key) is NEVER hijacked', async () => {
    // the user-reported state: zhipu + GLM-5.3-Flash, no zhipu key, but an
    // apiKeys entry and a custom model exist — requests must really go to zhipu
    const cm = await loadWith({
      provider: 'zhipu',
      model: 'GLM-5.3-Flash',
      apiKey: '',
      apiKeys: { deepseek: 'k' },
      customModels: ['GLM-5.3-Flash'],
    });
    const ai = cm.getAIConfig();
    expect(ai.usingBuiltinKey).toBeFalsy();
    expect(ai.provider).toBe('zhipu');
    expect(ai.model).toBe('GLM-5.3-Flash');

    const cm2 = await loadWith({ provider: 'zhipu', model: 'glm-5.2', apiKey: '' });
    expect(cm2.getAIConfig().usingBuiltinKey).toBeFalsy(); // non-default model = explicit choice
  });
});

describe('per-model contextLength is honored at startup', () => {
  it('effectiveContextLength prefers modelSettings[model].contextLength', () => {
    const c = {
      contextLength: 50,
      model: 'qwen3.6',
      modelSettings: { 'qwen3.6': { contextLength: 100 } },
    } as unknown as Config;
    expect(effectiveContextLength(c)).toBe(100);
  });

  it('falls back to the global contextLength, then 50', () => {
    expect(effectiveContextLength({ contextLength: 30, model: 'm' } as Config)).toBe(30);
    expect(effectiveContextLength({ model: 'm' } as Config)).toBe(50);
  });
});

describe('provider-tagged model history', () => {
  it('records and filters by provider; legacy strings are quarantined as unknown', () => {
    // simulate a legacy file of bare strings
    writeFileSync(join(root, '.thatgfsj', 'models.json'), JSON.stringify(['old-model']), 'utf-8');
    const legacy = loadModelHistory();
    expect(legacy).toEqual([{ id: 'old-model', provider: 'unknown' }]);

    recordModelUse('kimi-k2.6', 'kimi');
    recordModelUse('glm-5.3', 'zhipu');

    // No provider sees unknown-tagged or foreign models — the old
    // cross-provider mix bug showed every id under every provider.
    expect(historyForProvider('deepseek').map(e => e.id)).toEqual([]);
    expect(historyForProvider('kimi').map(e => e.id)).toEqual(['kimi-k2.6']);
    expect(historyForProvider('zhipu').map(e => e.id)).toEqual(['glm-5.3']);
    // unknown provider keeps current model anchoring
    expect(historyForProvider('openai', 'gpt-5.4-mini').map(e => e.id)).toEqual(['gpt-5.4-mini']);
  });
});

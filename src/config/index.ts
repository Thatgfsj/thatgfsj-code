/**
 * Config Manager - Handles configuration loading and saving
 * Supports custom providers (relay stations / 中转站)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { Config, AIConfig, ProviderName } from './types.js';
import { PROVIDERS, getApiKeyFromEnv, isCustomProvider } from './providers.js';
import { BUILTIN_MODEL_ID, BUILTIN_PROVIDER, revealBuiltinKey } from './builtin.js';

const DEFAULT_CONFIG: Config = {
  model: 'Qwen/Qwen3.5-4B',
  apiKey: '',
  temperature: 0.7,
  maxTokens: 4096,
  contextLength: 50,
  provider: 'siliconflow',
  // v3.0.0: prompt cache policy. v3.0.4: default TTL is 1h (long-task).
  // We cannot predict task length at round 0, so we default to the TTL
  // that cannot expire mid-task. 5m is opt-in via /ttl 5m or init wizard.
  cache: {
    enabled: true,
    ttl: '1h',
    strategy: 'auto',
  },
};

const DEFAULT_BROWSER_SETUP: NonNullable<Config['browserSetup']> = { done: false };

/** Spread `override` over `base`, tolerating null / non-object values. */
function mergeObject<T extends object>(base: T, override: unknown): T {
  const extra = override && typeof override === 'object' && !Array.isArray(override)
    ? override as Partial<T>
    : {};
  return { ...base, ...extra };
}

const VALID_TTL = new Set(['5m', '1h', 'auto']);

/**
 * v3.4.2: hand-edited config.json must never corrupt state silently OR be
 * written back to disk in broken form. Everything here sanitizes on LOAD
 * (with a console.warn), so the in-memory config is always well-typed and
 * the next save() persists clean data.
 */
function sanitizeCustomModels(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    const clean = raw.filter((m): m is string => typeof m === 'string' && !!m.trim());
    if (clean.length !== raw.length) {
      console.warn('[config] customModels 含非字符串项，已忽略非法项');
    }
    return clean;
  }
  // A bare string used to be spread into single characters and written back
  // (['g','l','m',…]) — treat it as one model id instead.
  console.warn('[config] customModels 应为数组，已按单个模型 id 处理');
  return typeof raw === 'string' && raw.trim() ? [raw.trim()] : [];
}

function sanitizeModelSettings(raw: unknown): NonNullable<Config['modelSettings']> {
  if (raw == null) return {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as NonNullable<Config['modelSettings']>;
  }
  console.warn('[config] modelSettings 应为对象，已忽略并回退默认');
  return {};
}

function sanitizeCache(raw: unknown): Config['cache'] {
  const base = { ...DEFAULT_CONFIG.cache! };
  if (raw == null) return base;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn('[config] cache 应为对象，已回退默认缓存策略');
    return base;
  }
  const merged = { ...base, ...(raw as Config['cache']) };
  if (merged.ttl != null && !VALID_TTL.has(merged.ttl)) {
    console.warn(`[config] cache.ttl "${String(merged.ttl)}" 非法（应为 5m/1h/auto），已回退 1h`);
    merged.ttl = '1h';
  }
  return merged;
}

export class ConfigManager {
  private configPath: string;
  private config: Config;

  private constructor(configPath: string, config: Config) {
    this.configPath = configPath;
    this.config = config;
  }

  /**
   * Load configuration from file + environment variables
   */
  static async load(): Promise<ConfigManager> {
    const configDir = join(homedir(), '.thatgfsj');
    const configPath = join(configDir, 'config.json');

    let config = { ...DEFAULT_CONFIG };

    // Load from file
    try {
      if (existsSync(configPath)) {
        const data = readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(data) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          // v3.4.2: per-provider key migration. The top-level apiKey used to
          // be resolved for whatever provider was current, so switching
          // provider in a hand edit sent the OLD provider's key to the NEW
          // one. Attribute the legacy key to the provider it was saved with,
          // then resolve strictly from apiKeys/env.
          const apiKeys = sanitizeApiKeys(parsed.apiKeys);
          if (!apiKeys && typeof parsed.apiKey === 'string' && parsed.apiKey) {
            parsed.apiKeys = { [String(parsed.provider || 'siliconflow')]: parsed.apiKey };
          }
          config = {
            ...config,
            ...parsed,
            // Nested keys merge two levels deep: a file missing a sub-key
            // keeps the built-in default for that sub-key.
            cache: sanitizeCache(parsed.cache),
            modelSettings: sanitizeModelSettings(parsed.modelSettings),
            browserSetup: mergeObject(DEFAULT_BROWSER_SETUP, parsed.browserSetup),
            customModels: sanitizeCustomModels(parsed.customModels),
          } as Config;
        }
      }
    } catch {
      // Corrupted file — fall back to defaults, but say why (a silent
      // fallback here made "my settings reset themselves" undebuggable).
      console.warn('[config] config.json 解析失败，已回退到默认配置');
    }

    // Resolve provider
    config = ConfigManager.resolveProvider(config);

    return new ConfigManager(configPath, config);
  }

  /**
   * Resolve provider settings: API key from env, base URL, model
   *
   * v3.4.2 key resolution (was the "old provider's key sent to the new
   * provider" bug): keys live in config.apiKeys[provider]; env overrides.
   * A key belonging to another provider is NEVER reused. Keyless providers
   * (ollama) always resolve to ''.
   */
  private static resolveProvider(config: Config): Config {
    const provider = config.provider || 'siliconflow';
    const providerConfig = PROVIDERS[provider];

    if (!providerConfig) {
      return { ...config, provider: 'siliconflow', baseUrl: PROVIDERS.siliconflow.baseUrl };
    }

    // Model: env MODEL > config > provider default
    const model = process.env.MODEL || config.model || providerConfig.defaultModel;

    // API key: env > per-provider store. Keyless providers need none.
    let apiKey = '';
    if (!providerConfig.keyless) {
      apiKey = getApiKeyFromEnv(provider)
        || config.apiKeys?.[provider]
        || '';
    }

    // Base URL: config > env > provider default
    let baseUrl = config.baseUrl;
    if (!baseUrl) {
      if (isCustomProvider(provider)) {
        baseUrl = process.env.CUSTOM_BASE_URL || '';
      } else {
        baseUrl = providerConfig.baseUrl;
      }
    }

    return { ...config, provider, baseUrl, model, apiKey: apiKey || '' };
  }

  /**
   * Get the current config
   */
  get(): Config {
    return { ...this.config };
  }

  /**
   * Get AIConfig for LLM providers
   *
   * v3.0.5: the cache policy is now forwarded. Previously getAIConfig
   * dropped it, so LLMService.fromConfig always fell back to defaults and
   * the user's cache.enabled / cache.ttl config never reached the wire.
   */
  getAIConfig(): AIConfig {
    const base = {
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      cache: this.config.cache,
    };

    // v3.1.2: out-of-box fallback. With no user API key configured (file or
    // env), fall back to the built-in shared SiliconFlow model so a fresh
    // install works immediately. The shared key is reassembled in memory —
    // it is NEVER written into config.json.
    // v3.4.2: keyless providers (ollama) never trigger it, and NEITHER does
    // any explicit user configuration (any stored key, a non-default model
    // or custom models). The blanket fallback used to hijack exactly those
    // setups: config.json said "zhipu / GLM-5.3-Flash" while every request
    // silently went to the shared cloud model — "written but unusable".
    const providerConfig = PROVIDERS[this.config.provider];
    // v3.4.3: explicit 内置共享 selection wins over everything.
    if (this.config.useBuiltin) {
      return {
        ...base,
        provider: BUILTIN_PROVIDER,
        model: BUILTIN_MODEL_ID,
        apiKey: revealBuiltinKey(),
        baseUrl: PROVIDERS.siliconflow.baseUrl,
        usingBuiltinKey: true,
      };
    }
    const explicitSetup =
      Object.keys(this.config.apiKeys || {}).length > 0
      || (!!this.config.model && this.config.model !== DEFAULT_CONFIG.model)
      || (this.config.customModels?.length ?? 0) > 0;
    if (!this.config.apiKey && !providerConfig?.keyless && !explicitSetup) {
      return {
        ...base,
        provider: BUILTIN_PROVIDER,
        model: BUILTIN_MODEL_ID,
        apiKey: revealBuiltinKey(),
        baseUrl: PROVIDERS.siliconflow.baseUrl,
        usingBuiltinKey: true,
      };
    }

    return {
      ...base,
      model: this.config.model,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      provider: this.config.provider,
    };
  }

  /**
   * Get provider format (openai | anthropic | gemini)
   */
  getProviderFormat(): 'openai' | 'anthropic' | 'gemini' {
    return PROVIDERS[this.config.provider]?.format || 'openai';
  }

  /**
   * Update config and save to file
   *
   * v3.4.2: saving an apiKey now ALSO records it under apiKeys[provider]
   * (legacy top-level field kept in sync for downgrade compatibility), so
   * keys stay attached to the provider they belong to.
   */
  async save(updates: Partial<Config>): Promise<void> {
    this.config = { ...this.config, ...updates };

    if (typeof updates.apiKey === 'string') {
      const keys = { ...(this.config.apiKeys || {}) };
      if (updates.apiKey) keys[this.config.provider] = updates.apiKey;
      else delete keys[this.config.provider];
      this.config.apiKeys = keys;
    }

    // v3.4.3: re-resolve after every save. A bare save({provider}) used to
    // leave the OLD provider's apiKey in memory (resolution only ran at
    // load), so the rest of the session kept using a key that no longer
    // belonged to the active provider.
    this.config = ConfigManager.resolveProvider(this.config);

    // useBuiltin is an explicit mode: set only by picking the 内置共享
    // entry; any other model choice leaves shared-model mode.
    if (updates.useBuiltin !== undefined) this.config.useBuiltin = updates.useBuiltin;
    else if (updates.model !== undefined) this.config.useBuiltin = false;

    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Atomic write: temp file in the same directory + renameSync, so a
    // crash mid-write can never leave a truncated config.json behind.
    const tmp = `${this.configPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(this.config, null, 2), 'utf-8');
      renameSync(tmp, this.configPath);
    } finally {
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best-effort */ }
    }
  }

  /**
   * Check if an API key is configured
   */
  hasApiKey(): boolean {
    const pc = PROVIDERS[this.config.provider];
    if (pc?.keyless) return true;
    return !!this.config.apiKey;
  }

  /**
   * Check if using a custom provider
   */
  isCustomProvider(): boolean {
    return isCustomProvider(this.config.provider);
  }
}

function sanitizeApiKeys(raw: unknown): Record<string, string> | null {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn('[config] apiKeys 应为对象，已忽略');
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

/**
 * Config Manager - Handles configuration loading and saving
 * Supports custom providers (relay stations / 中转站)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { Config, AIConfig, ProviderName } from './types.js';
import { PROVIDERS, getApiKeyFromEnv, isCustomProvider } from './providers.js';

const DEFAULT_CONFIG: Config = {
  model: 'Qwen/Qwen2.5-7B-Instruct',
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

/**
 * Nested-object defaults for the three nested config keys. On load they are
 * merged two levels deep ({ ...default, ...fileValue }) so a config.json
 * that is missing a sub-key (e.g. cache.ttl after a hand edit) keeps the
 * built-in default for that sub-key instead of wiping it to undefined.
 */
const DEFAULT_MODEL_SETTINGS: NonNullable<Config['modelSettings']> = {};
const DEFAULT_BROWSER_SETUP: NonNullable<Config['browserSetup']> = { done: false };

/** Spread `override` over `base`, tolerating null / non-object values. */
function mergeObject<T extends object>(base: T, override: unknown): T {
  const extra = override && typeof override === 'object' && !Array.isArray(override)
    ? override as Partial<T>
    : {};
  return { ...base, ...extra };
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
          config = {
            ...config,
            ...parsed,
            // Nested keys merge two levels deep: a file missing a sub-key
            // keeps the built-in default for that sub-key.
            cache: mergeObject(DEFAULT_CONFIG.cache ?? {}, parsed.cache),
            modelSettings: mergeObject(DEFAULT_MODEL_SETTINGS, parsed.modelSettings),
            browserSetup: mergeObject(DEFAULT_BROWSER_SETUP, parsed.browserSetup),
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
   */
  private static resolveProvider(config: Config): Config {
    const provider = config.provider || 'siliconflow';
    const providerConfig = PROVIDERS[provider];

    if (!providerConfig) {
      return { ...config, provider: 'siliconflow', baseUrl: PROVIDERS.siliconflow.baseUrl };
    }

    // Model: env MODEL > config > provider default
    const model = process.env.MODEL || config.model || providerConfig.defaultModel;

    // API key: env > config
    let apiKey = config.apiKey;
    if (provider === 'ollama') {
      apiKey = '';
    } else if (!apiKey) {
      apiKey = getApiKeyFromEnv(provider);
    }

    // Base URL: config > env > provider default
    let baseUrl = config.baseUrl;
    if (!baseUrl) {
      // Check env for custom base URL
      if (provider === 'custom_openai') {
        baseUrl = process.env.CUSTOM_BASE_URL || '';
      } else if (provider === 'custom_anthropic') {
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
    return {
      model: this.config.model,
      apiKey: this.config.apiKey,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      baseUrl: this.config.baseUrl,
      provider: this.config.provider,
      cache: this.config.cache,
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
   */
  async save(updates: Partial<Config>): Promise<void> {
    this.config = { ...this.config, ...updates };

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
    return !!this.config.apiKey;
  }

  /**
   * Check if using a custom provider
   */
  isCustomProvider(): boolean {
    return isCustomProvider(this.config.provider);
  }
}

/**
 * Config Manager - Handles configuration loading and saving
 * Supports custom providers (relay stations / 中转站)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
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
};

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
        config = { ...config, ...JSON.parse(data) };
      }
    } catch {
      // Use defaults if file is corrupted
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
   */
  getAIConfig(): AIConfig {
    return {
      model: this.config.model,
      apiKey: this.config.apiKey,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
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
   */
  async save(updates: Partial<Config>): Promise<void> {
    this.config = { ...this.config, ...updates };

    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
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

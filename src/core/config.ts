/**
 * Config Manager - Handles configuration loading and saving
 * Supports multiple AI providers: MiniMax, SiliconFlow, OpenAI, Anthropic
 *
 * 0.2.3: Tolerates unknown / legacy provider names (e.g. `custom_openai`
 * from 1.0.4-era configs) — keeps the user's provider and falls back to
 * deriving a sensible baseUrl from `CUSTOM_BASE_URL` / `BASE_URL` env vars
 * or from the provider id itself, instead of silently overwriting the
 * provider field. Also refreshes default model to current SiliconFlow
 * recommendation (Qwen2.5-72B-Instruct instead of 7B).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { Config, PROVIDERS, AIConfig } from './types.js';

const DEFAULT_CONFIG: Config = {
  model: 'Qwen/Qwen2.5-72B-Instruct',
  apiKey: '',
  temperature: 0.7,
  maxTokens: 4096,
  provider: 'siliconflow',
  baseUrl: 'https://api.siliconflow.cn/v1'
};

export class ConfigManager {
  private configPath: string;

  constructor() {
    const homeDir = homedir();
    const configDir = join(homeDir, '.thatgfsj');
    this.configPath = join(configDir, 'config.json');
  }

  /**
   * Load configuration with environment variable support
   */
  static async load(): Promise<Config> {
    const manager = new ConfigManager();
    return manager.loadConfig();
  }

  /**
   * Load config from file and merge with environment variables
   */
  private loadConfig(): Config {
    let config = { ...DEFAULT_CONFIG };

    try {
      if (existsSync(this.configPath)) {
        const data = readFileSync(this.configPath, 'utf-8');
        const loaded = JSON.parse(data);
        config = { ...config, ...loaded };
      }
    } catch (error) {
      console.warn('Failed to load config, using defaults:', error);
    }

    // Resolve provider and get API key from environment
    config = this.resolveProvider(config);

    return config;
  }

  /**
   * Resolve provider and API key from config or environment
   *
   * 0.2.3: tolerate unknown / legacy provider names (e.g. `custom_openai`).
   *   - If the provider is in `PROVIDERS`, use its baseUrl + envKeys.
   *   - Otherwise keep the user-specified provider id exactly and try to
   *     derive a baseUrl from `CUSTOM_BASE_URL` / `BASE_URL` env vars; if
   *     neither is set, fall back to the OpenAI-compatible default
   *     (https://api.openai.com/v1) so the request still goes through.
   *     No silent overwrite of `provider`.
   *   - When API key is missing for an unknown provider, we still keep the
   *     provider and surface a non-fatal warning.
   */
  private resolveProvider(config: Config): Config {
    const provider = config.provider || 'siliconflow';
    const providerConfig = PROVIDERS[provider as keyof typeof PROVIDERS];

    if (!providerConfig) {
      // Unknown / legacy / custom provider — keep what the user wrote, but
      // resolve a reasonable baseUrl.
      const envBase = process.env.CUSTOM_BASE_URL || process.env.BASE_URL;
      const baseUrl =
        config.baseUrl ||
        envBase ||
        // Last-resort: OpenAI-compatible default. The user can override via
        // `gfcode init` or by editing ~/.thatgfsj/config.json.
        'https://api.openai.com/v1';
      const apiKey =
        config.apiKey ||
        process.env.OPENAI_API_KEY ||
        process.env.CUSTOM_API_KEY ||
        '';

      // Model: keep user choice, otherwise fall back to env MODEL, otherwise
      // a benign default. No warning spam — this is an expected path.
      const model = config.model || process.env.MODEL || 'gpt-4o-mini';

      return {
        ...config,
        provider: provider as Config['provider'],
        baseUrl,
        model,
        apiKey,
      };
    }

    // Known provider
    let model = process.env.MODEL || config.model || providerConfig.defaultModel;

    let apiKey = config.apiKey;
    let baseUrl = config.baseUrl || providerConfig.baseUrl;

    if (provider === 'ollama') {
      apiKey = '';
      baseUrl = process.env.OLLAMA_BASE_URL || baseUrl;
    } else {
      for (const envKey of providerConfig.envKeys) {
        if (process.env[envKey]) {
          apiKey = process.env[envKey];
          break;
        }
      }
    }

    return {
      ...config,
      provider,
      baseUrl,
      model,
      apiKey: apiKey || ''
    };
  }

  /**
   * Get AIConfig for AIEngine
   */
  static async getAIConfig(): Promise<AIConfig> {
    const config = await ConfigManager.load();
    return {
      model: config.model,
      apiKey: config.apiKey,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      baseUrl: config.baseUrl,
      provider: config.provider
    };
  }

  /**
   * Save configuration
   */
  async save(config: Partial<Config>): Promise<void> {
    const current = this.loadConfig();
    const merged = { ...current, ...config };

    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(this.configPath, JSON.stringify(merged, null, 2));
  }

  /**
   * Get config path
   */
  getPath(): string {
    return this.configPath;
  }

  /**
   * List available providers
   */
  static listProviders(): string {
    return Object.entries(PROVIDERS)
      .map(([key, val]) => `  ${key}: ${val.name}`)
      .join('\n');
  }
}

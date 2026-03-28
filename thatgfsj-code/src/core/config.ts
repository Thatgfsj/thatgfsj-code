/**
 * Config Manager - Handles configuration loading and saving
 * Supports multiple AI providers: MiniMax, SiliconFlow, OpenAI, Anthropic
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { Config, PROVIDERS, AIConfig } from './types.js';

const DEFAULT_CONFIG: Config = {
  model: 'Qwen/Qwen2.5-7B-Instruct',
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
   */
  private resolveProvider(config: Config): Config {
    const provider = config.provider || 'siliconflow';
    const providerConfig = (provider !== 'custom' && provider !== undefined) ? PROVIDERS[provider] : null;

    if (!providerConfig) {
      console.warn(`Unknown provider: ${provider}, falling back to siliconflow`);
      return { ...config, provider: 'siliconflow', baseUrl: PROVIDERS.siliconflow.baseUrl };
    }

    // MODEL environment variable has highest priority
    let model = process.env.MODEL || config.model || providerConfig.defaultModel;
    
    // Handle Ollama (local, no API key needed)
    let apiKey = config.apiKey;
    let baseUrl = config.baseUrl || providerConfig.baseUrl;
    
    if (provider === 'ollama') {
      // Ollama doesn't need an API key
      apiKey = '';
      // Allow custom base URL via environment
      baseUrl = process.env.OLLAMA_BASE_URL || baseUrl;
    } else {
      // Try to get API key from environment
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

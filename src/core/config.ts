/**
 * Config Manager - Handles configuration loading and saving
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { Config } from './types.js';

const DEFAULT_CONFIG: Config = {
  model: 'minimax/MiniMax-M2.5',
  apiKey: '',
  temperature: 0.7,
  maxTokens: 4096
};

export class ConfigManager {
  private configPath: string;

  constructor() {
    const homeDir = homedir();
    const configDir = join(homeDir, '.thatgfsj');
    this.configPath = join(configDir, 'config.json');
  }

  /**
   * Load configuration
   */
  static async load(): Promise<Config> {
    const manager = new ConfigManager();
    return manager.loadConfig();
  }

  /**
   * Load config from file
   */
  private loadConfig(): Config {
    try {
      if (existsSync(this.configPath)) {
        const data = readFileSync(this.configPath, 'utf-8');
        const loaded = JSON.parse(data);
        return { ...DEFAULT_CONFIG, ...loaded };
      }
    } catch (error) {
      console.warn('Failed to load config, using defaults:', error);
    }
    
    return { ...DEFAULT_CONFIG };
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
}

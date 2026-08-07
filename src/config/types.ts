/**
 * Configuration types for Thatgfsj Code
 */

export type ProviderName =
  | 'siliconflow'
  | 'openai'
  | 'deepseek'
  | 'kimi'
  | 'zhipu'
  | 'minimax'
  | 'baichuan'
  | 'stepfun'
  | 'doubao'
  | 'anthropic'
  | 'gemini'
  | 'ollama'
  | 'ernie'
  | 'custom_openai'
  | 'custom_anthropic';

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  defaultModel: string;
  envKeys: string[];
  format: 'openai' | 'anthropic' | 'gemini';
}

export interface Config {
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  contextLength: number;
  provider: ProviderName;
  baseUrl?: string;
  /**
   * v3.0.0: prompt-cache policy. Default = Anthropic-style explicit
   * cache_control on (ttl 5m), all other providers fall through to their
   * built-in automatic caching.
   *
   * Note: enabling/disabling only affects Anthropic; other providers do
   * not expose a programmatic cache toggle, so the flag is purely
   * advisory there.
   */
  cache?: {
    enabled: boolean;
    ttl?: '5m' | '1h';
    strategy?: 'auto' | 'manual' | 'off';
  };
}

export interface AIConfig {
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
  provider?: ProviderName;
}

export interface ModelInfo {
  id: string;
  name: string;
  desc: string;
}

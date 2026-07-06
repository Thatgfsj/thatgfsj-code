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

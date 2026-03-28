/**
 * Type definitions for Thatgfsj Code
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: Role;
  content: string;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string; // For thinking models (Kimi, DeepSeek, etc.)
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AIResponse {
  content: string;
  role: 'assistant';
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  tool_calls?: ToolCall[];
  reasoning_content?: string; // For thinking models (Kimi, DeepSeek, etc.)
}

export interface AIConfig {
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
  provider?: 'minimax' | 'openai' | 'siliconflow' | 'anthropic' | 'ollama' | 'custom' | 'gemini' | 'kimi' | 'deepseek' | 'ernie';
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (params: Record<string, any>, ctx?: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  sessionId?: string;
  confirmAction?: (msg: string) => Promise<boolean>;
}

export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  data?: any;
}

export interface Session {
  id: string;
  messages: ChatMessage[];
  createdAt: Date;
  lastActiveAt: Date;
}

export interface Config {
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  provider?: 'minimax' | 'openai' | 'siliconflow' | 'anthropic' | 'ollama' | 'custom' | 'gemini' | 'kimi' | 'deepseek' | 'ernie';
  baseUrl?: string;
}

// Provider configurations
export const PROVIDERS = {
  minimax: {
    name: 'MiniMax',
    // Use Anthropic-compatible API for M2.5/M2.1/M2 models
    baseUrl: 'https://api.minimax.io/anthropic/v1',
    defaultModel: 'MiniMax-M2.5',
    envKeys: ['MINIMAX_API_KEY', 'OPENAI_API_KEY']
  },
  siliconflow: {
    name: 'SiliconFlow (硅基流动)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    envKeys: ['SILICONFLOW_API_KEY', 'OPENAI_API_KEY']
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    envKeys: ['OPENAI_API_KEY']
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-haiku-20240307',
    envKeys: ['ANTHROPIC_API_KEY']
  },
  ollama: {
    name: 'Ollama (Local)',
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    defaultModel: 'llama2',
    envKeys: []
  },
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-1.5-flash',
    envKeys: ['GEMINI_API_KEY']
  },
  kimi: {
    name: 'Kimi (Moonshot AI)',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    envKeys: ['KIMI_API_KEY', 'MOONSHOT_API_KEY']
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    envKeys: ['DEEPSEEK_API_KEY']
  },
  ernie: {
    name: 'Baidu ERNIE (文心一言)',
    baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1',
    defaultModel: 'ernie-4.0-8k',
    envKeys: ['ERNIE_API_KEY', 'BAIDU_API_KEY']
  }
} as const;

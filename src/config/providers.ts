/**
 * Provider definitions and model catalogs
 * Updated with correct API formats and more providers
 */

import type { ProviderConfig, ProviderName, ModelInfo } from './types.js';

// ==================== Provider Definitions ====================

export const PROVIDERS: Record<ProviderName, ProviderConfig> = {
  siliconflow: {
    name: 'SiliconFlow (硅基流动)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    envKeys: ['SILICONFLOW_API_KEY'],
    format: 'openai',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    envKeys: ['OPENAI_API_KEY'],
    format: 'openai',
  },
  deepseek: {
    name: 'DeepSeek (深度求索)',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    envKeys: ['DEEPSEEK_API_KEY'],
    format: 'openai',
  },
  kimi: {
    name: 'Kimi (月之暗面)',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.6',
    envKeys: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    format: 'openai',
  },
  zhipu: {
    name: 'Zhipu GLM (智谱)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    envKeys: ['ZHIPU_API_KEY', 'GLM_API_KEY'],
    format: 'openai',
  },
  minimax: {
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    defaultModel: 'MiniMax-Text-01',
    envKeys: ['MINIMAX_API_KEY'],
    format: 'openai',
  },
  baichuan: {
    name: 'Baichuan (百川)',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    defaultModel: 'Baichuan4',
    envKeys: ['BAICHUAN_API_KEY'],
    format: 'openai',
  },
  stepfun: {
    name: 'Stepfun (阶跃星辰)',
    baseUrl: 'https://api.stepfun.com/v1',
    defaultModel: 'step-1-flash',
    envKeys: ['STEPFUN_API_KEY'],
    format: 'openai',
  },
  doubao: {
    name: 'Doubao (火山引擎豆包)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-1.5-pro-32k',
    envKeys: ['DOUBAO_API_KEY', 'ARK_API_KEY'],
    format: 'openai',
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    envKeys: ['ANTHROPIC_API_KEY'],
    format: 'anthropic',
  },
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    envKeys: ['GEMINI_API_KEY'],
    format: 'gemini',
  },
  ollama: {
    name: 'Ollama (本地)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    envKeys: [],
    format: 'openai',
  },
  ernie: {
    name: 'ERNIE (百度文心)',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    defaultModel: 'ernie-4.5-8k',
    envKeys: ['ERNIE_API_KEY', 'QIANFAN_API_KEY'],
    format: 'openai',
  },
  custom_openai: {
    name: '自定义 OpenAI 兼容 (中转站)',
    baseUrl: '',
    defaultModel: 'gpt-4o-mini',
    envKeys: ['CUSTOM_API_KEY'],
    format: 'openai',
  },
  custom_anthropic: {
    name: '自定义 Anthropic 兼容 (中转站)',
    baseUrl: '',
    defaultModel: 'claude-sonnet-4-20250514',
    envKeys: ['CUSTOM_API_KEY'],
    format: 'anthropic',
  },
};

// ==================== Model Catalogs ====================

export const MODEL_CATALOGS: Record<ProviderName, ModelInfo[]> = {
  siliconflow: [
    { id: 'Qwen/Qwen2.5-7B-Instruct', name: 'Qwen2.5-7B', desc: '免费，日常编程' },
    { id: 'Qwen/Qwen2.5-32B-Instruct', name: 'Qwen2.5-32B', desc: '更强性能' },
    { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5-72B', desc: '旗舰模型' },
    { id: 'Qwen/Qwen3-8B', name: 'Qwen3-8B', desc: '最新 Qwen3' },
    { id: 'Pro/deepseek-ai/DeepSeek-V3', name: 'DeepSeek-V3', desc: '深度求索' },
    { id: 'Pro/deepseek-ai/DeepSeek-R1', name: 'DeepSeek-R1', desc: '推理模型' },
    { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek-V3 (免费)', desc: '免费版' },
    { id: 'THUDM/glm-4-9b-chat', name: 'GLM-4-9B', desc: '智谱模型' },
    { id: 'internlm/internlm2_5-7b-chat', name: 'InternLM2.5-7B', desc: '书生模型' },
  ],
  openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o-mini', desc: '性价比高' },
    { id: 'gpt-4o', name: 'GPT-4o', desc: '旗舰多模态' },
    { id: 'gpt-4-turbo', name: 'GPT-4-Turbo', desc: '强性能' },
    { id: 'o3-mini', name: 'o3-mini', desc: '推理模型' },
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek-Chat', desc: '通用对话' },
    { id: 'deepseek-reasoner', name: 'DeepSeek-Reasoner', desc: '推理增强' },
  ],
  kimi: [
    { id: 'kimi-k2.6', name: 'Kimi K2.6', desc: '最新旗舰，支持思考' },
    { id: 'kimi-k2.5', name: 'Kimi K2.5', desc: '稳定版' },
    { id: 'moonshot-v1-128k', name: 'Moonshot-128K', desc: '超长上下文' },
    { id: 'moonshot-v1-32k', name: 'Moonshot-32K', desc: '长上下文' },
    { id: 'moonshot-v1-8k', name: 'Moonshot-8K', desc: '基础版' },
  ],
  zhipu: [
    { id: 'glm-4-plus', name: 'GLM-4-Plus', desc: '旗舰模型' },
    { id: 'glm-4-flash', name: 'GLM-4-Flash', desc: '快速免费' },
    { id: 'glm-4-long', name: 'GLM-4-Long', desc: '超长上下文 1M' },
    { id: 'glm-4-flashx', name: 'GLM-4-FlashX', desc: '加速版' },
    { id: 'glm-4-air', name: 'GLM-4-Air', desc: '轻量版' },
  ],
  minimax: [
    { id: 'MiniMax-Text-01', name: 'MiniMax-Text-01', desc: '旗舰模型' },
    { id: 'abab6.5s-chat', name: 'abab6.5s', desc: '轻量版' },
  ],
  baichuan: [
    { id: 'Baichuan4', name: 'Baichuan4', desc: '最新旗舰' },
    { id: 'Baichuan3-Turbo', name: 'Baichuan3-Turbo', desc: '快速版' },
  ],
  stepfun: [
    { id: 'step-1-flash', name: 'Step-1-Flash', desc: '快速免费' },
    { id: 'step-1-8k', name: 'Step-1-8K', desc: '基础版' },
    { id: 'step-2-16k', name: 'Step-2-16K', desc: '增强版' },
  ],
  doubao: [
    { id: 'doubao-1.5-pro-32k', name: 'Doubao-1.5-Pro-32K', desc: '旗舰版' },
    { id: 'doubao-1.5-lite-32k', name: 'Doubao-1.5-Lite-32K', desc: '轻量版' },
    { id: 'doubao-pro-256k', name: 'Doubao-Pro-256K', desc: '超长上下文' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', desc: '最新旗舰' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', desc: '快速便宜' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', desc: '最强性能' },
  ],
  gemini: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', desc: '最新快速' },
    { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', desc: '最强推理' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', desc: '经典版' },
  ],
  ollama: [
    { id: 'llama3.1', name: 'Llama 3.1', desc: 'Meta 开源' },
    { id: 'qwen2.5', name: 'Qwen 2.5', desc: '通义千问' },
    { id: 'deepseek-coder-v2', name: 'DeepSeek Coder V2', desc: '编程专用' },
    { id: 'codellama', name: 'Code Llama', desc: 'Meta 编程' },
    { id: 'mistral', name: 'Mistral', desc: '高性能' },
  ],
  ernie: [
    { id: 'ernie-4.5-8k', name: 'ERNIE-4.5-8K', desc: '最新旗舰' },
    { id: 'ernie-4.0-8k', name: 'ERNIE-4.0-8K', desc: '强性能' },
    { id: 'ernie-3.5-8k', name: 'ERNIE-3.5-8K', desc: '性价比高' },
  ],
  custom_openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o-mini', desc: '默认模型，可自定义' },
    { id: 'gpt-4o', name: 'GPT-4o', desc: '可自定义' },
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', desc: '可自定义' },
  ],
  custom_anthropic: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', desc: '默认模型，可自定义' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', desc: '可自定义' },
  ],
};

// ==================== Helpers ====================

export function getModelsForProvider(provider: ProviderName): ModelInfo[] {
  return MODEL_CATALOGS[provider] || [];
}

export function getApiKeyFromEnv(provider: ProviderName): string {
  const providerConfig = PROVIDERS[provider];
  if (!providerConfig) return '';
  for (const envKey of providerConfig.envKeys) {
    if (process.env[envKey]) return process.env[envKey];
  }
  return '';
}

export function listProviders(): Array<{ key: ProviderName; name: string }> {
  return Object.entries(PROVIDERS).map(([key, val]) => ({
    key: key as ProviderName,
    name: val.name,
  }));
}

/**
 * Check if a provider name is a custom/relay provider
 */
export function isCustomProvider(provider: ProviderName): boolean {
  return provider === 'custom_openai' || provider === 'custom_anthropic';
}

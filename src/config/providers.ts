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
    defaultModel: 'Qwen/Qwen3.5-35B-A3B',
    envKeys: ['SILICONFLOW_API_KEY'],
    format: 'openai',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4-mini',
    envKeys: ['OPENAI_API_KEY'],
    format: 'openai',
  },
  deepseek: {
    name: 'DeepSeek (深度求索)',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
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
    defaultModel: 'glm-5.2',
    envKeys: ['ZHIPU_API_KEY', 'GLM_API_KEY'],
    format: 'openai',
  },
  minimax: {
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    defaultModel: 'MiniMax-M2.5',
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
    defaultModel: 'claude-sonnet-5',
    envKeys: ['ANTHROPIC_API_KEY'],
    format: 'anthropic',
  },
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.8-flash',
    envKeys: ['GEMINI_API_KEY'],
    format: 'gemini',
  },
  ollama: {
    name: 'Ollama (本地)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen3.6',
    envKeys: [],
    format: 'openai',
    keyless: true,
  },
  ernie: {
    name: 'ERNIE (百度文心)',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    defaultModel: 'ernie-5.0-thinking-latest',
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
  // v3.5.4 (field report P1): Gemini-format relay users had no exit — the
  // gemini provider's baseUrl is pinned to the official endpoint and there
  // was no custom_gemini entry, unlike openai/anthropic.
  custom_gemini: {
    name: '自定义 Gemini 兼容 (中转站)',
    baseUrl: '',
    defaultModel: 'gemini-2.5-flash',
    envKeys: ['CUSTOM_API_KEY'],
    format: 'gemini',
  },
};

// ==================== Model Catalogs ====================

/**
 * v3.6.0 (context-field-report): known context windows per model id. The
 * blind 128k default was wrong in BOTH directions — the built-in
 * Qwen3.5-4B is 262,144 (percentages displayed ~2x too big), while catalog
 * entries like step-1-8k (8k) hit the real window 16x before any
 * compaction fired → provider 400s. Models not listed keep the config
 * default. Sources: vendor model cards / platform docs.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'Qwen/Qwen3.5-4B': 262144, // built-in shared model
  'step-1-8k': 8192,
  'step-2-16k': 16384,
  'doubao-1.5-pro-32k': 32768,
  'doubao-1.5-lite-32k': 32768,
  'doubao-pro-256k': 262144,
  'gpt-6-astra': 1000000,
  'kimi-k3': 1000000,
  'glm-5.3': 1000000,
  // v3.5.4: same model, SiliconFlow's catalog id — users were getting the
  // 128k fallback for a 1M-window model and compacting way too early.
  'zai-org/GLM-5.3': 1000000,
};

export const MODEL_CATALOGS: Record<ProviderName, ModelInfo[]> = {
  // 2026-09 目录更新（来源：各平台官方定价页/文档核实；baichuan/stepfun/doubao
  // 未查到可靠的 2026-09 现行清单，保留原目录取自其官方文档旧版）
  siliconflow: [
    { id: 'Qwen/Qwen3.5-35B-A3B', name: 'Qwen3.5-35B-A3B', desc: '超低价 MoE 快档，日常编程首选' },
    { id: 'deepseek-ai/DeepSeek-V4-Pro', name: 'DeepSeek-V4-Pro', desc: 'DeepSeek 旗舰/思考档' },
    { id: 'deepseek-ai/DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash', desc: '便宜快档' },
    { id: 'deepseek-ai/DeepSeek-V3.2', name: 'DeepSeek-V3.2', desc: '上一代稳定版' },
    { id: 'zai-org/GLM-5.3', name: 'GLM-5.3', desc: 'GLM 旗舰/思考档' },
    { id: 'zai-org/GLM-5.2', name: 'GLM-5.2', desc: 'GLM 稳定中档' },
    { id: 'moonshotai/Kimi-K2.7-Code', name: 'Kimi-K2.7-Code', desc: '编码特化' },
    { id: 'moonshotai/Kimi-K2.6', name: 'Kimi-K2.6', desc: '通用/多模态' },
    { id: 'Qwen/Qwen3.8-27B', name: 'Qwen3.8-27B', desc: 'Qwen 最新稠密档' },
  ],
  openai: [
    { id: 'gpt-5.4-mini', name: 'GPT-5.4-mini', desc: '迷你快档' },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', desc: '中档主力' },
    { id: 'gpt-6-astra', name: 'GPT-6-Astra', desc: '旗舰，1M 上下文' },
    { id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex', desc: '写码特化' },
  ],
  deepseek: [
    { id: 'deepseek-flash', name: 'DeepSeek-Flash', desc: 'V4.1-Flash 快档，默认带思考' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', desc: '旗舰' },
  ],
  kimi: [
    { id: 'kimi-k2.6', name: 'Kimi K2.6', desc: '通用快档' },
    { id: 'kimi-k3', name: 'Kimi K3', desc: '旗舰，1M 上下文' },
    { id: 'kimi-k2.7-code', name: 'Kimi K2.7-Code', desc: '编码特化' },
  ],
  zhipu: [
    { id: 'glm-5.2', name: 'GLM-5.2', desc: '稳定中档' },
    { id: 'glm-5.3', name: 'GLM-5.3', desc: '旗舰/思考档，1M 上下文' },
    { id: 'glm-5', name: 'GLM-5', desc: '编程套餐档' },
  ],
  minimax: [
    { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5', desc: '旗舰/思考档' },
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
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', desc: '快档' },
    { id: 'claude-opus-5', name: 'Claude Opus 5', desc: '中档旗舰' },
    { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', desc: '旗舰，1M 上下文' },
  ],
  gemini: [
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', desc: '最新工作马快档' },
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', desc: '旗舰' },
    { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', desc: '超低价档' },
  ],
  ollama: [
    { id: 'qwen3.6', name: 'Qwen 3.6', desc: '本地综合首选，agentic coding 强' },
    { id: 'gpt-oss:20b', name: 'GPT-OSS 20B', desc: '16GB 显存推荐' },
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', desc: '本地快档' },
    { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash', desc: 'GLM 本地小档' },
    { id: 'gemma4', name: 'Gemma 4', desc: '轻量通用' },
  ],
  ernie: [
    { id: 'ernie-5.0-thinking-latest', name: 'ERNIE-5.0-Thinking', desc: '思考档' },
    { id: 'ernie-5.0-preview-1220', name: 'ERNIE-5.0-Preview', desc: '全模态预览旗舰' },
  ],
  custom_openai: [
    { id: 'gpt-5.4-mini', name: 'GPT-5.4-mini', desc: '默认模型，可自定义' },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', desc: '可自定义' },
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', desc: '可自定义' },
  ],
  custom_anthropic: [
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', desc: '默认模型，可自定义' },
    { id: 'claude-opus-5', name: 'Claude Opus 5', desc: '可自定义' },
  ],
  custom_gemini: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: '默认模型，可自定义' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: '可自定义' },
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
  return provider === 'custom_openai' || provider === 'custom_anthropic' || provider === 'custom_gemini';
}

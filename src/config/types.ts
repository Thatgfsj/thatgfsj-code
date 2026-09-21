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
  | 'custom_anthropic'
  | 'custom_gemini';

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  defaultModel: string;
  envKeys: string[];
  format: 'openai' | 'anthropic' | 'gemini';
  /** v3.4.2: providers that need no API key (local runtimes like Ollama). */
  keyless?: boolean;
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
   * v3.4.2: API keys per provider. The legacy top-level `apiKey` only ever
   * described the provider it was saved with; reusing it after a provider
   * switch sent the old key to the new endpoint. On load, a legacy key is
   * migrated to apiKeys[savedProvider]. Env vars still override.
   */
  apiKeys?: Record<string, string>;
  /**
   * v3.4.3: explicit opt-in to the built-in shared model (set when the user
   * picks the 内置共享 entry). Explicit setup would otherwise block the
   * out-of-box fallback forever.
   */
  useBuiltin?: boolean;
  /**
   * v3.0.0: prompt-cache policy. Default = Anthropic-style explicit
   * cache_control on (ttl 5m), all other providers fall through to their
   * built-in automatic caching.
   *
   * Note: enabling/disabling only affects Anthropic; other providers do
   * not expose a programmatic cache toggle, so the flag is purely
   * advisory there.
   *
   * v3.0.3: `ttl` accepts '5m' | '1h' | 'auto'. 'auto' lets the runtime
   * pick the TTL based on conversation length (decideTTL in smartModel.ts).
   * The wizard's default is 'auto' so users don't have to choose.
   */
  cache?: {
    enabled: boolean;
    ttl?: '5m' | '1h' | 'auto';
    strategy?: 'auto' | 'manual' | 'off';
  };
  /**
   * v3.0.8: per-model settings managed by the /models dialog.
   * - contextLength: overrides the global contextLength for this model
   * - thinking: reasoning effort sent to thinking-capable models
   *   ('off' sends no thinking params at all — maximum compatibility)
   */
  modelSettings?: Record<string, {
    contextLength?: number;
    thinking?: 'off' | 'low' | 'medium' | 'high';
    /** v3.0.13: model context window in tokens — auto-compact fires at 85%. */
    contextWindow?: number;
  }>;
  /**
   * v3.0.13: default context window (tokens) for models without a
   * per-model override. Auto-compact triggers at 85% of it.
   */
  contextWindow?: number;
  /**
   * v3.0.13: first-run browser (Playwright) setup state — the question
   * is only asked once; mode records what was set up. v3.0.14: the
   * bundled Chromium is used exclusively (never the user's own browser).
   */
  browserSetup?: { done: boolean; mode?: 'chromium' | 'declined' };
  /**
   * v3.0.8: user-added model ids (via /models → 添加模型). Free-text ids
   * that join the provider's catalog in the model picker.
   */
  customModels?: string[];
  /**
   * v3.5.0: set to false to stop gfc from auto-creating the NWT process
   * timeline (.nwt/) in every project it runs in. Default: enabled. The
   * first creation in a project also prints a one-line notice.
   */
  nwt?: boolean;
}

export interface AIConfig {
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
  provider?: ProviderName;
  /**
   * v3.0.5: cache policy is forwarded to providers (was dropped by
   * getAIConfig before, so cache.ttl config never reached the wire).
   */
  cache?: Config['cache'];
  /**
   * v3.1.2: true when no user API key is configured and getAIConfig fell
   * back to the built-in shared SiliconFlow model (Qwen/Qwen3.5-4B).
   */
  usingBuiltinKey?: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  desc: string;
}

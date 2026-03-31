/**
 * Type definitions for Thatgfsj Code
 * S02: Enhanced Tool interface with Builder pattern, inputSchema, and metadata
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: Role;
  content: string;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
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
  reasoning_content?: string;
}

export interface AIConfig {
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
  provider?: 'minimax' | 'openai' | 'siliconflow' | 'anthropic' | 'ollama' | 'custom' | 'gemini' | 'kimi' | 'deepseek' | 'ernie';
}

// ==================== S02: Enhanced Tool Interface ====================

/**
 * Tool parameter with type support
 */
export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: any;
  enum?: string[];
}

/**
 * S02: Input Schema — JSON Schema style tool input definition
 * Claude Code uses this for structured tool parameter validation
 */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description: string;
    default?: any;
    enum?: string[];
  }>;
  required?: string[];
}

/**
 * S02: Tool metadata — extra info beyond name/description
 */
export interface ToolMetadata {
  /** Permission category: read, write, execute, network */
  permissions?: ('read' | 'write' | 'execute' | 'network')[];
  /** Max execution time in ms */
  maxDuration?: number;
  /** Tags for categorization */
  tags?: string[];
  /** Version */
  version?: string;
  /** Deprecation notice */
  deprecated?: string;
}

/**
 * S02: Tool interface with inputSchema + metadata
 * Both 'parameters' (legacy) and 'inputSchema' (new) are supported
 */
export interface Tool {
  name: string;
  description: string;
  /** Legacy parameter list (still used by existing tools) */
  parameters: ToolParameter[];
  /** S02: JSON Schema for tool input (computed from parameters) */
  inputSchema?: ToolInputSchema;
  /** S02: Metadata for permissions, tags, etc. */
  metadata?: ToolMetadata;
  execute(params: Record<string, any>, ctx?: ToolContext): Promise<ToolResult>;
}

/**
 * S02: Enriched execution context
 */
export interface ToolContext {
  sessionId?: string;
  workingDirectory?: string;
  confirmAction?: (msg: string) => Promise<boolean>;
  signal?: AbortSignal;
  toolCallId?: string;
}

// Legacy alias
export { ToolParameter as ToolParam };

/**
 * S02: Tool Builder — fluent API to construct tools
 */
export class ToolBuilder {
  private _name = '';
  private _description = '';
  private _parameters: ToolParameter[] = [];
  private _inputSchema: ToolInputSchema = { type: 'object', properties: {} };
  private _metadata: ToolMetadata = {};
  private _fn?: (params: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>;

  name(n: string): this { this._name = n; return this; }
  description(d: string): this { this._description = d; return this; }

  param(p: ToolParameter): this {
    this._parameters.push(p);
    this._inputSchema.properties[p.name] = {
      type: p.type,
      description: p.description,
      default: p.default,
      enum: p.enum
    };
    return this;
  }

  stringParam(name: string, description: string, required = true, defaultVal?: string): this {
    return this.param({ name, type: 'string', description, required, default: defaultVal });
  }

  numberParam(name: string, description: string, required = true, defaultVal?: number): this {
    return this.param({ name, type: 'number', description, required, default: defaultVal });
  }

  booleanParam(name: string, description: string, required: boolean = false, defaultVal?: boolean): this {
    return this.param({ name, type: 'boolean', description, required, default: defaultVal });
  }

  required(...names: string[]): this {
    this._inputSchema.required = names;
    return this;
  }

  meta(m: ToolMetadata): this {
    this._metadata = { ...this._metadata, ...m };
    return this;
  }

  permissions(...perms: ('read' | 'write' | 'execute' | 'network')[]): this {
    this._metadata.permissions = perms;
    return this;
  }

  tags(...t: string[]): this {
    this._metadata.tags = t;
    return this;
  }

  handle(fn: (params: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>): this {
    this._fn = fn;
    return this;
  }

  build(): Tool {
    if (!this._name || !this._fn) {
      throw new Error('Tool name and handler are required');
    }
    return {
      name: this._name,
      description: this._description,
      parameters: this._parameters,
      inputSchema: this._inputSchema,
      metadata: this._metadata,
      execute: this._fn
    };
  }
}

// ==================== Tool Registry Enhancement ====================

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

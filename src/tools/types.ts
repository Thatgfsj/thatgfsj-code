/**
 * Tool interface definitions
 * Extracted from old src/core/types.ts
 */

// ==================== Tool Parameter & Schema ====================

export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: any;
  enum?: string[];
}

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

export interface ToolMetadata {
  permissions?: ('read' | 'write' | 'execute' | 'network')[];
  maxDuration?: number;
  tags?: string[];
  version?: string;
  deprecated?: string;
}

// ==================== Tool Interface ====================

export interface ToolContext {
  sessionId?: string;
  workingDirectory?: string;
  confirmAction?: (msg: string) => Promise<boolean>;
  signal?: AbortSignal;
  toolCallId?: string;
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  data?: any;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  inputSchema?: ToolInputSchema;
  metadata?: ToolMetadata;
  execute(params: Record<string, any>, ctx?: ToolContext): Promise<ToolResult>;
}

// ==================== Tool Builder ====================

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
      enum: p.enum,
    };
    return this;
  }

  stringParam(name: string, description: string, required = true, defaultVal?: string): this {
    return this.param({ name, type: 'string', description, required, default: defaultVal });
  }

  booleanParam(name: string, description: string, required = false, defaultVal?: boolean): this {
    return this.param({ name, type: 'boolean', description, required, default: defaultVal });
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
      execute: this._fn,
    };
  }
}

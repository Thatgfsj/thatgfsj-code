/**
 * Tool Registry - Manages available tools with context support
 * S02: Enhanced with inputSchema generation and permission metadata
 */

import { Tool, ToolResult, ToolContext, ToolInputSchema } from './types.js';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private context: ToolContext = {};

  constructor() {
    this.registerDefaultTools();
  }

  setContext(ctx: Partial<ToolContext>) {
    this.context = { ...this.context, ...ctx };
  }

  getContext(): ToolContext {
    return this.context;
  }

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`Tool ${tool.name} already exists, overwriting...`);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * S02: Get tools formatted for AI API
   * Uses inputSchema if available, otherwise builds from parameters
   */
  getToolsForAPI() {
    return Array.from(this.tools.values()).map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema || this.buildInputSchema(tool)
      }
    }));
  }

  /**
   * S02: Build JSON Schema from legacy parameters array
   */
  private buildInputSchema(tool: Tool): ToolInputSchema {
    return {
      type: 'object',
      properties: tool.parameters.reduce((acc, p) => {
        acc[p.name] = {
          type: p.type === 'string' ? 'string'
              : p.type === 'number' ? 'number'
              : p.type === 'boolean' ? 'boolean'
              : 'string',
          description: p.description
        };
        return acc;
      }, {} as Record<string, { type: string; description: string }>),
      required: tool.parameters.filter(p => p.required).map(p => p.name)
    };
  }

  /**
   * S02: List all tools with their metadata
   */
  listAll() {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      permissions: t.metadata?.permissions,
      tags: t.metadata?.tags,
      deprecated: t.metadata?.deprecated
    }));
  }

  async execute(name: string, params: Record<string, any>): Promise<ToolResult> {
    const tool = this.tools.get(name);

    if (!tool) {
      return { success: false, error: `Tool "${name}" not found` };
    }

    // S02: Validate params against inputSchema
    const validationError = this.validateParams(tool, params);
    if (validationError) {
      return { success: false, error: validationError };
    }

    try {
      return await tool.execute(params, this.context);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * S02: Validate params against tool's inputSchema
   */
  private validateParams(tool: Tool, params: Record<string, any>): string | null {
    const schema = tool.inputSchema || this.buildInputSchema(tool);

    // Check required
    if (schema.required) {
      for (const req of schema.required) {
        if (params[req] === undefined || params[req] === null) {
          return `Missing required parameter: ${req}`;
        }
      }
    }

    // Check types
    for (const [key, value] of Object.entries(params)) {
      const prop = schema.properties[key];
      if (prop && value !== undefined) {
        const expectedType = prop.type;
        const actualType = typeof value;
        // Type coercion for string/number
        if (expectedType === 'number' && actualType === 'string' && !isNaN(Number(value))) {
          // Auto-coerce strings to numbers — ok
        } else if (actualType !== expectedType) {
          return `Invalid type for ${key}: expected ${expectedType}, got ${actualType}`;
        }
      }
    }

    return null;
  }

  async executeAll(tools: Array<{ name: string; params: Record<string, any> }>): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const { name, params } of tools) {
      const result = await this.execute(name, params);
      results.push(result);
      if (!result.success) break;
    }
    return results;
  }

  private registerDefaultTools(): void {
    // Tools registered externally via AIEngine
  }
}

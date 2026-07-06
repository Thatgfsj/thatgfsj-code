/**
 * Tool Registry - Manages available tools
 * Migrated from old src/core/tool-registry.ts + src/tools/index.ts
 */

import type { Tool, ToolResult, ToolContext, ToolInputSchema } from './types.js';
import { FileTool } from './file.js';
import { ShellTool } from './shell.js';
import { GitTool } from './git.js';
import { SearchTool } from './search.js';
import { NwtTool } from './nwt.js';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private context: ToolContext = {};

  constructor() {
    this.registerDefaults();
  }

  /**
   * Register default built-in tools
   */
  private registerDefaults(): void {
    this.register(new FileTool());
    this.register(new ShellTool());
    this.register(new GitTool());
    this.register(new SearchTool());
    this.register(new NwtTool());
  }

  setContext(ctx: Partial<ToolContext>): void {
    this.context = { ...this.context, ...ctx };
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  listNames(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * Get tools formatted for AI API
   */
  getToolsForAPI(): Array<{ type: 'function'; function: any }> {
    return [...this.tools.values()].map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema || this.buildInputSchema(tool),
      },
    }));
  }

  /**
   * Build JSON Schema from legacy parameters array
   */
  private buildInputSchema(tool: Tool): ToolInputSchema {
    return {
      type: 'object',
      properties: tool.parameters.reduce((acc, p) => {
        acc[p.name] = {
          type: p.type === 'number' ? 'number' : p.type === 'boolean' ? 'boolean' : 'string',
          description: p.description,
        };
        return acc;
      }, {} as Record<string, { type: string; description: string }>),
      required: tool.parameters.filter(p => p.required).map(p => p.name),
    };
  }

  /**
   * Execute a tool by name
   */
  async execute(name: string, params: Record<string, any>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool "${name}" not found` };
    }

    try {
      return await tool.execute(params, this.context);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

// Re-export types and tools
export type { Tool, ToolResult, ToolContext, ToolParameter, ToolInputSchema, ToolMetadata } from './types.js';
export { ToolBuilder } from './types.js';
export { FileTool } from './file.js';
export { ShellTool } from './shell.js';
export { GitTool } from './git.js';
export { SearchTool } from './search.js';
export { NwtTool } from './nwt.js';

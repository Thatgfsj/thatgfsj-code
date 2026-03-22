/**
 * Tool Registry - Manages available tools with context support
 */

import { Tool, ToolResult, ToolContext } from './types.js';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private context: ToolContext = {};

  constructor() {
    this.registerDefaultTools();
  }

  /**
   * Set execution context (for confirmation callbacks, etc.)
   */
  setContext(ctx: Partial<ToolContext>) {
    this.context = { ...this.context, ...ctx };
  }

  /**
   * Get current context
   */
  getContext(): ToolContext {
    return this.context;
  }

  /**
   * Register a tool
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`Tool ${tool.name} already exists, overwriting...`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get tool by name
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * List all tool names
   */
  list(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get all tools with descriptions
   */
  listAll(): Array<{ name: string; description: string }> {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description
    }));
  }

  /**
   * Execute a tool with context
   */
  async execute(name: string, params: Record<string, any>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    
    if (!tool) {
      return {
        success: false,
        error: `Tool "${name}" not found`
      };
    }

    try {
      return await tool.execute(params, this.context);
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute multiple tools in sequence
   */
  async executeAll(tools: Array<{ name: string; params: Record<string, any> }>): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const { name, params } of tools) {
      const result = await this.execute(name, params);
      results.push(result);
      // Stop if any tool fails
      if (!result.success) break;
    }
    return results;
  }

  /**
   * Register default built-in tools
   */
  private registerDefaultTools(): void {
    // Tools are registered externally via AIEngine
  }
}

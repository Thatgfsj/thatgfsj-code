/**
 * Tool Registry - Manages available tools
 */

import { Tool, ToolResult } from './types.js';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    this.registerDefaultTools();
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
   * Execute a tool
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
      return await tool.execute(params);
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Register default built-in tools
   */
  private registerDefaultTools(): void {
    // Tools will be imported from tools/
    // For now, tools are registered externally
  }
}

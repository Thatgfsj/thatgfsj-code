/**
 * Tools Module
 * Built-in tools + Plugin loading
 */

import { Tool } from '../core/types.js';
import { FileTool } from './file.js';
import { ShellTool } from './shell.js';
import { GitTool } from './git.js';
import { SearchTool } from './search.js';

/**
 * Get all built-in tools
 */
export function getBuiltInTools(): Tool[] {
  return [
    new FileTool(),
    new ShellTool(),
    new GitTool(),
    new SearchTool()
  ];
}

/**
 * Tool descriptions for AI
 */
export function getToolDescriptions(): Record<string, string> {
  return {
    file: 'File operations: read, write, list, delete, exists, mkdir',
    shell: 'Execute shell commands (npm, git, node, etc.)',
    git: 'Git operations: status, log, diff, commit, branch, checkout, pull, push',
    search: 'Search code: grep, find files, directory tree'
  };
}

/**
 * Load custom tools from config (future)
 */
export async function loadCustomTools(config: Record<string, any>): Promise<Tool[]> {
  // TODO: Implement plugin loading from config
  // Example: load from ~/.thatgfsj/tools/*.js
  return [];
}

export { FileTool } from './file.js';
export { ShellTool } from './shell.js';
export { GitTool } from './git.js';
export { SearchTool } from './search.js';

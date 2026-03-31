/**
 * File Tool - File operations
 */

import { Tool, ToolResult } from '../core/types.js';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname, basename, extname } from 'path';

export class FileTool implements Tool {
  name = 'file';
  description = 'Perform file operations: read, write, list, delete, etc.';

  inputSchema = {
    type: 'object' as const,
    properties: {
      action: { type: 'string', description: 'Action: read, write, list, delete, exists, mkdir' },
      path: { type: 'string', description: 'File or directory path' },
      content: { type: 'string', description: 'Content to write (for write action)' }
    },
    required: ['action', 'path']
  };

  metadata = {
    permissions: ['read', 'write'] as ('read' | 'write' | 'execute' | 'network')[],
    tags: ['file', 'filesystem'],
    maxDuration: 30000,
    version: '1.0.0'
  };

  parameters = [
    { name: 'action', type: 'string', description: 'Action to perform: read, write, list, delete, exists', required: true },
    { name: 'path', type: 'string', description: 'File or directory path', required: true },
    { name: 'content', type: 'string', description: 'Content to write (for write action)', required: false }
  ];

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const { action, path, content } = params;
    
    try {
      switch (action) {
        case 'read':
          return this.readFile(path);
        case 'write':
          return this.writeFile(path, content || '');
        case 'list':
          return this.listDir(path);
        case 'delete':
          return this.deleteFile(path);
        case 'exists':
          return this.checkExists(path);
        case 'mkdir':
          return this.mkdir(path);
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private readFile(path: string): ToolResult {
    if (!existsSync(path)) {
      return { success: false, error: `File not found: ${path}` };
    }
    
    const content = readFileSync(path, 'utf-8');
    return { success: true, output: content };
  }

  private writeFile(path: string, content: string): ToolResult {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    writeFileSync(path, content, 'utf-8');
    return { success: true, output: `File written: ${path}` };
  }

  private listDir(path: string): ToolResult {
    if (!existsSync(path)) {
      return { success: false, error: `Directory not found: ${path}` };
    }
    
    const files = readdirSync(path);
    const items = files.map(f => {
      const fullPath = join(path, f);
      const stat = statSync(fullPath);
      return {
        name: f,
        type: stat.isDirectory() ? 'dir' : 'file',
        size: stat.size,
        modified: stat.mtime.toISOString()
      };
    });
    
    return { success: true, output: JSON.stringify(items, null, 2) };
  }

  private deleteFile(path: string): ToolResult {
    if (!existsSync(path)) {
      return { success: false, error: `Path not found: ${path}` };
    }
    
    unlinkSync(path);
    return { success: true, output: `Deleted: ${path}` };
  }

  private checkExists(path: string): ToolResult {
    return { success: true, output: existsSync(path) ? 'true' : 'false' };
  }

  private mkdir(path: string): ToolResult {
    mkdirSync(path, { recursive: true });
    return { success: true, output: `Created: ${path}` };
  }
}

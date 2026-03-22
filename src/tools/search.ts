/**
 * Search Tool - Code search and file operations
 */

import { Tool, ToolResult } from '../core/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const execAsync = promisify(exec);

export class SearchTool implements Tool {
  name = 'search';
  description = 'Search and find: grep, find files, list directory tree';
  
  parameters = [
    { name: 'action', type: 'string', description: 'Action: grep, find, tree, files', required: true },
    { name: 'pattern', type: 'string', description: 'Search pattern or file pattern', required: false },
    { name: 'path', type: 'string', description: 'Directory to search in', required: false },
    { name: 'options', type: 'string', description: 'Additional options', required: false }
  ];

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const { action, pattern, path, options } = params;
    const workDir = path || process.cwd();
    
    try {
      switch (action) {
        case 'grep':
        case 'search':
          return await this.grep(pattern || '', workDir, options || '');
        
        case 'find':
          return await this.find(pattern || '*', workDir);
        
        case 'tree':
          return await this.tree(workDir, parseInt(options) || 3);
        
        case 'files':
          return await this.listFiles(workDir, pattern || '*');
        
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Grep - search for pattern in files
   */
  private async grep(pattern: string, path: string, options: string): Promise<ToolResult> {
    if (!pattern) {
      return { success: false, error: 'Pattern required' };
    }
    
    // Build grep command
    let cmd = `grep -rn "${pattern}" "${path}"`;
    
    if (options?.includes('i')) cmd += ' -i';  // Case insensitive
    if (options?.includes('w')) cmd += ' -w';  // Whole word
    if (options?.includes('l')) cmd += ' -l';  // Files only
    if (options?.includes('n')) cmd += ' -n';  // Line numbers
    
    cmd += ' --color=never';
    
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
      
      if (!stdout && stderr) {
        return { success: false, error: stderr };
      }
      
      const lines = (stdout || '').split('\n').filter(l => l.trim());
      
      if (lines.length === 0) {
        return { success: true, output: 'No matches found' };
      }
      
      // Limit output
      const limited = lines.slice(0, 50);
      const output = limited.join('\n');
      
      return { 
        success: true, 
        output: lines.length > 50 
          ? output + `\n... and ${lines.length - 50} more matches`
          : output 
      };
      
    } catch (error: any) {
      if (error.killed) {
        return { success: false, error: 'Search timed out (>30s)' };
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Find - find files by pattern
   */
  private async find(pattern: string, path: string): Promise<ToolResult> {
    if (!pattern) {
      pattern = '*';
    }
    
    const results: string[] = [];
    
    const search = (dir: string, depth: number) => {
      if (depth > 5) return; // Max depth
      
      try {
        const items = readdirSync(dir);
        
        for (const item of items) {
          // Skip common ignored directories
          if (item === 'node_modules' || item === '.git' || item === 'dist' || item === 'build') {
            continue;
          }
          
          const fullPath = join(dir, item);
          
          try {
            const stat = statSync(fullPath);
            
            if (stat.isDirectory()) {
              // Check if matches pattern
              if (this.matchPattern(item, pattern)) {
                results.push(fullPath);
              }
              search(fullPath, depth + 1);
            } else if (stat.isFile()) {
              if (this.matchPattern(item, pattern)) {
                results.push(fullPath);
              }
            }
          } catch {
            // Skip inaccessible files
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };
    
    search(path, 0);
    
    if (results.length === 0) {
      return { success: true, output: 'No files found' };
    }
    
    const limited = results.slice(0, 100);
    const output = limited.join('\n');
    
    return {
      success: true,
      output: results.length > 100
        ? output + `\n... and ${results.length - 100} more files`
        : output
    };
  }

  /**
   * Tree - show directory structure
   */
  private async tree(path: string, maxDepth: number): Promise<ToolResult> {
    const lines: string[] = [];
    
    const walk = (dir: string, prefix: string, depth: number) => {
      if (depth > maxDepth) return;
      
      try {
        const items = readdirSync(dir).filter(i => 
          !i.startsWith('.') && i !== 'node_modules' && i !== 'dist'
        );
        
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const fullPath = join(dir, item);
          const isLast = i === items.length - 1;
          const connector = isLast ? '└── ' : '├── ';
          
          lines.push(prefix + connector + item);
          
          try {
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
              const newPrefix = prefix + (isLast ? '    ' : '│   ');
              walk(fullPath, newPrefix, depth + 1);
            }
          } catch {
            // Skip
          }
        }
      } catch {
        // Skip inaccessible
      }
    };
    
    lines.push(relative(process.cwd(), path) || '.');
    walk(path, '', 0);
    
    return { success: true, output: lines.join('\n') };
  }

  /**
   * List files in directory
   */
  private async listFiles(path: string, pattern: string): Promise<ToolResult> {
    const files: string[] = [];
    
    const scan = (dir: string) => {
      try {
        const items = readdirSync(dir);
        
        for (const item of items) {
          if (item === 'node_modules' || item === '.git') continue;
          
          const fullPath = join(dir, item);
          
          try {
            const stat = statSync(fullPath);
            if (stat.isFile() && this.matchPattern(item, pattern)) {
              files.push(relative(process.cwd(), fullPath));
            }
          } catch {
            // Skip
          }
        }
      } catch {
        // Skip
      }
    };
    
    scan(path);
    
    if (files.length === 0) {
      return { success: true, output: 'No files found' };
    }
    
    return { success: true, output: files.join('\n') };
  }

  /**
   * Simple glob-like pattern matching
   */
  private matchPattern(filename: string, pattern: string): boolean {
    if (pattern === '*') return true;
    
    // Convert glob to regex
    const regex = new RegExp(
      '^' + pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') + '$',
      'i'
    );
    
    return regex.test(filename);
  }
}

/**
 * Search Tool - Code search and file operations
 *
 * v3.0.5: the grep action no longer shells out to Unix `grep` — which both
 * injected the pattern into a shell string AND made the tool permanently
 * broken on Windows (the author's own platform). It is now a pure-JS scan
 * with the same output shape (`file:line: text`), case-insensitive /
 * whole-word / files-only options, binary + size limits, and no shell.
 */

import type { Tool, ToolResult } from './types.js';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.nwt', '.thatgfsj']);
const MAX_FILE_BYTES = 1024 * 1024; // 1MB per file
const MAX_MATCHES = 50;

export class SearchTool implements Tool {
  name = 'search';
  description = 'Search and find: grep, find files, list directory tree';

  parameters = [
    { name: 'action', type: 'string', description: 'Action: grep, find, tree, files', required: true },
    { name: 'pattern', type: 'string', description: 'Search pattern or file pattern', required: false },
    { name: 'path', type: 'string', description: 'Directory to search in', required: false },
    { name: 'options', type: 'string', description: 'Options string: i (case-insensitive), w (whole word), l (files only), n (line numbers)', required: false }
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
   * Pure-JS grep. `pattern` is treated as a regex when valid, and as a
   * literal string otherwise (so patterns like `foo(` still work).
   */
  private async grep(pattern: string, path: string, options: string): Promise<ToolResult> {
    if (!pattern) {
      return { success: false, error: 'Pattern required' };
    }

    const caseInsensitive = options?.includes('i');
    const wholeWord = options?.includes('w');
    const filesOnly = options?.includes('l');
    const withLineNumbers = !options || options.includes('n') || options.length === 0;

    let regex: RegExp;
    try {
      let source = pattern;
      if (wholeWord) source = `\\b${source}\\b`;
      regex = new RegExp(source, caseInsensitive ? 'i' : '');
    } catch {
      // Invalid regex — fall back to a literal (escaped) match.
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const source = wholeWord ? `\\b${escaped}\\b` : escaped;
      regex = new RegExp(source, caseInsensitive ? 'i' : '');
    }

    const matches: string[] = [];
    const matchedFiles = new Set<string>();
    let truncated = false;

    const scan = (dir: string, depth: number): void => {
      if (depth > 8 || (matches.length >= MAX_MATCHES && !filesOnly)) return;

      let items: string[];
      try {
        items = readdirSync(dir);
      } catch {
        return;
      }

      for (const item of items) {
        if (IGNORED_DIRS.has(item) || item.startsWith('.')) continue;
        const full = join(dir, item);

        let stat;
        try {
          stat = statSync(full);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          scan(full, depth + 1);
          continue;
        }
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;

        let content: string;
        try {
          const buf = readFileSync(full);
          // Skip binary-looking files (NUL byte in the first 8KB).
          const sample = buf.subarray(0, 8192);
          if (sample.includes(0)) continue;
          content = buf.toString('utf-8');
        } catch {
          continue;
        }

        const lines = content.split('\n');
        let fileMatched = false;
        for (let i = 0; i < lines.length; i++) {
          if (!regex.test(lines[i])) continue;
          fileMatched = true;
          matchedFiles.add(full);
          if (!filesOnly) {
            const rel = relative(process.cwd(), full) || full;
            const text = lines[i].trim().slice(0, 200);
            matches.push(withLineNumbers ? `${rel}:${i + 1}: ${text}` : `${rel}: ${text}`);
            if (matches.length >= MAX_MATCHES) {
              truncated = true;
              return;
            }
          }
        }
        if (filesOnly && fileMatched && matchedFiles.size >= MAX_MATCHES) {
          truncated = true;
          return;
        }
      }
    };

    scan(path, 0);

    if (filesOnly) {
      if (matchedFiles.size === 0) return { success: true, output: 'No matches found' };
      const list = [...matchedFiles].slice(0, MAX_MATCHES)
        .map(f => relative(process.cwd(), f) || f);
      return {
        success: true,
        output: list.join('\n') + (matchedFiles.size >= MAX_MATCHES ? `\n... and more files` : ''),
      };
    }

    if (matches.length === 0) {
      return { success: true, output: 'No matches found' };
    }

    const suffix = truncated
      ? `\n... and more matches (refine the pattern or path)`
      : '';
    return { success: true, output: matches.join('\n') + suffix };
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

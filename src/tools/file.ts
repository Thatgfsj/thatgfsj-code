/**
 * File Tool - File operations
 *
 * v3.0.5: write and delete now route through the permission pipeline.
 * - write shows a line diff (utils/diff.ts, previously dead code) via
 *   ctx.confirmEdit before touching the file
 * - delete asks via ctx.confirmAction
 * - read/list/exists/mkdir stay silent (read-class operations)
 * With no context wired (should not happen — App always installs one) we
 * fail closed for destructive actions instead of silently executing.
 */

import type { Tool, ToolResult, ToolContext } from './types.js';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { DiffPreview } from '../utils/diff.js';

export class FileTool implements Tool {
  name = 'file';
  description = 'Perform file operations: read, write, list, delete, etc.';

  inputSchema = {
    type: 'object' as const,
    properties: {
      action: { type: 'string', description: 'Action: read, write, list, delete, exists, mkdir' },
      path: { type: 'string', description: 'File or directory path' },
      content: { type: 'string', description: 'Content to write (REQUIRED for write action; omit entirely for read/list/exists/delete/mkdir)' }
    },
    // v3.5.1: content stays OUT of the schema-level required list. Making it
    // schema-required rejected read/exists calls too (weak models pad
    // content:"" everywhere) and sent them into PARAM_ERROR retry loops.
    // The write guard below enforces it at runtime for action=write only.
    required: ['action', 'path']
  };

  metadata = {
    permissions: ['read', 'write'] as ('read' | 'write' | 'execute' | 'network')[],
    tags: ['file', 'filesystem'],
    version: '1.1.1'
  };

  parameters = [
    { name: 'action', type: 'string', description: 'Action to perform: read, write, list, delete, exists', required: true },
    { name: 'path', type: 'string', description: 'File or directory path', required: true },
    { name: 'content', type: 'string', description: 'Content to write (required for write; do not pass for other actions)', required: false }
  ];

  async execute(params: Record<string, any>, ctx?: ToolContext): Promise<ToolResult> {
    const { action, path, content } = params;

    // v3.5.0: double-guard the write path. The schema marks content as
    // required (the agent loop rejects such calls before execution with a
    // repair message), but a direct/legacy caller must not produce a
    // 0-byte file either.
    if (action === 'write' && (typeof content !== 'string' || content.length === 0)) {
      return {
        success: false,
        error: `[PARAM_ERROR] action=write requires a non-empty 'content' string. Retry including the full content to write.`,
      };
    }

    try {
      switch (action) {
        case 'read':
          return this.readFile(path);
        case 'write':
          return await this.writeFile(path, content as string, ctx);
        case 'list':
          return this.listDir(path);
        case 'delete':
          return await this.deleteFile(path, ctx);
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

    const buffer = readFileSync(path);

    // Check for binary files (first 8KB)
    const sample = buffer.slice(0, 8192);
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) {
        return { success: false, error: `Binary file detected: ${path}` };
      }
    }

    // Try UTF-8 first, fallback to latin1
    let content: string;
    try {
      content = buffer.toString('utf-8');
      // Check for replacement characters (encoding error indicator)
      if (content.includes('\uFFFD')) {
        content = buffer.toString('latin1');
      }
    } catch {
      content = buffer.toString('latin1');
    }

    // Truncate large files
    const MAX_SIZE = 8000;
    if (content.length > MAX_SIZE) {
      content = content.slice(0, MAX_SIZE) + '\n\n... [truncated, file too large]';
    }
    // v3.5.0: an empty file must SAY it is empty — the model used to get
    // output:"" (truthy-falsy nowhere), never learning its write failed.
    if (buffer.length === 0) {
      return { success: true, output: `(empty file, 0 bytes): ${path}` };
    }
    return { success: true, output: content };
  }

  private async writeFile(path: string, content: string, ctx?: ToolContext): Promise<ToolResult> {
    // v3.0.5: permission gate with diff preview. Fail closed when no
    // confirmation channel is available at all.
    if (ctx?.confirmEdit) {
      const original = existsSync(path) ? (() => {
        try { return readFileSync(path, 'utf-8'); } catch { return ''; }
      })() : '';
      const diff = DiffPreview.diff(original, content);
      const status = existsSync(path)
        ? `修改文件 (−${diff.removed} / +${diff.added} 行)`
        : `新建文件 (+${diff.added} 行)`;
      const preview = diff.added + diff.removed > 400
        ? DiffPreview.truncate(diff)
        : DiffPreview.format(diff);
      const ok = await ctx.confirmEdit({
        message: `${status}: ${path}\n\n${preview}`,
      });
      if (!ok) {
        return { success: false, error: 'File write cancelled by user' };
      }
    } else {
      // v3.0.5 fix: symmetric fail-closed — no confirmation channel at all
      // (not even a context) means no writes, same as deleteFile.
      return { success: false, error: 'File write requires confirmation, but no confirmation channel is available' };
    }

    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(path, content, 'utf-8');
    // v3.5.0: report the byte count so "wrote something" is verifiable —
    // a silent 0-byte success was the root of the empty-write bug class.
    const bytes = Buffer.byteLength(content, 'utf-8');
    return { success: true, output: `File written: ${path} (${bytes} bytes)` };
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

  private async deleteFile(path: string, ctx?: ToolContext): Promise<ToolResult> {
    if (!existsSync(path)) {
      return { success: false, error: `Path not found: ${path}` };
    }

    // v3.0.5: delete is destructive — always ask, fail closed without a channel.
    if (ctx?.confirmAction) {
      const ok = await ctx.confirmAction(`删除文件: ${path}`);
      if (!ok) {
        return { success: false, error: 'File deletion cancelled by user' };
      }
    } else {
      return { success: false, error: 'File deletion requires confirmation, but no confirmation channel is available' };
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

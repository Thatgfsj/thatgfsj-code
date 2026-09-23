/**
 * Write File Tool — dedicated write surface with a REQUIRED content
 * parameter (v3.5.4 field report, round 7).
 *
 * History: file write lived on the shared `file` tool with content marked
 * optional. The agent-loop repair message caught missing content at
 * runtime, but the SCHEMA the model sees still said "optional" — and
 * 35B-A3B / DeepSeek-V4-Flash dropped content on essentially every write,
 * burning the circuit breaker with zero output. Proven model-size
 * independent: the schema is the only signal every tokenizer faithfully
 * carries. `content` is required HERE, in the tools JSON.
 *
 * The legacy `file` tool keeps a runtime guard for action=write so old
 * sessions/relays that still call it get the repair signal instead of a
 * 0-byte file.
 */

import type { Tool, ToolResult, ToolContext } from './types.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { assertWorkspacePath } from './fence.js';
export class WriteFileTool implements Tool {
  name = 'write_file';
  description =
    'Create or overwrite a file. content is REQUIRED and must be the FULL final text of the file. Confined to the project directory.';

  inputSchema = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'File path (project-relative, or absolute inside the project)' },
      content: { type: 'string', description: 'The FULL final text to write' },
    },
    required: ['path', 'content'],
  };

  metadata = {
    permissions: ['write'] as ('read' | 'write' | 'execute' | 'network')[],
    tags: ['file', 'filesystem', 'write'],
    version: '1.0.0',
  };

  parameters = [
    { name: 'path', type: 'string', description: 'File path', required: true },
    { name: 'content', type: 'string', description: 'The FULL final text to write', required: true },
  ];

  async execute(params: Record<string, any>, ctx?: ToolContext): Promise<ToolResult> {
    const { path, content } = params;

    if (typeof content !== 'string' || content.length === 0) {
      return {
        success: false,
        error: `[PARAM_ERROR] write_file requires a non-empty 'content' string. Retry including the full text to write.`,
      };
    }

    const fence = assertWorkspacePath('write_file', path, ctx);
    if (fence) return fence;

    if (ctx?.confirmEdit) {
      const status = existsSync(path) ? `覆盖文件: ${path}` : `新建文件: ${path}`;
      const ok = await ctx.confirmEdit({
        message: `${status}\n（${content.split('\n').length} 行 / ${Buffer.byteLength(content, 'utf-8')} 字节）`,
      });
      if (!ok) {
        return { success: false, error: 'File write cancelled by user' };
      }
    } else {
      return { success: false, error: 'write_file requires confirmation, but no confirmation channel is available (headless? add --yolo)' };
    }

    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path, content, 'utf-8');
      const bytes = Buffer.byteLength(content, 'utf-8');
      return { success: true, output: `File written: ${path} (${bytes} bytes)` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

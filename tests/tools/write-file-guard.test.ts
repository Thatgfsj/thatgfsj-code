// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WriteFileTool } from '../../src/tools/write-file.js';

/**
 * v3.5.4 (round 7) regressions: the dedicated write_file tool whose schema
 * REQUIRES content — the round-6/7 finding was that shared-schema file
 * write dropped `content` on every call regardless of model size.
 */
describe('write_file tool', () => {
  let proj: string;
  let tool: WriteFileTool;
  const ctx = () => ({
    confirmEdit: async () => true,
    workingDirectory: proj,
  }) as any;

  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'nwt-wf-'));
    tool = new WriteFileTool();
  });

  afterEach(() => {
    rmSync(proj, { recursive: true, force: true });
  });

  it('schema requires path AND content (the tokenizer-faithful signal)', () => {
    expect(tool.inputSchema.required).toEqual(['path', 'content']);
    expect(tool.parameters.every(p => p.required)).toBe(true);
  });

  it('rejects empty content without touching disk', async () => {
    const p = join(proj, 'x.txt');
    const r = await tool.execute({ path: p, content: '' }, ctx());
    expect(r.success).toBe(false);
    expect(String(r.error)).toMatch(/PARAM_ERROR/);
    expect(existsSync(p)).toBe(false);
  });

  it('writes bytes and reports the count', async () => {
    const p = join(proj, 'hello.txt');
    const r = await tool.execute({ path: p, content: 'hello' }, ctx());
    expect(r.success).toBe(true);
    expect(String(r.output)).toContain('5 bytes');
    expect(readFileSync(p, 'utf-8')).toBe('hello');
  });

  it('refuses targets outside the workspace', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'nwt-wf-out-'));
    const r = await tool.execute(
      { path: join(outside, 'x.txt'), content: 'x' },
      ctx(),
    );
    expect(r.success).toBe(false);
    expect(String(r.error)).toMatch(/WORKSPACE/);
    rmSync(outside, { recursive: true, force: true });
  });
});

/**
 * v3.5.4 (round 8): DATA_GUARD is session-scoped — "write fails in round
 * N, delete lands in round N+1" must be blocked (round-8 mock verified a
 * real cross-round deletion).
 */
describe('llm data guard: cross-round delete block', () => {
  it('blocks a delete in the round AFTER a failed write', async () => {
    const { LLMService } = await import('../../src/llm/index.js');
    const type = await import('../../src/types.js');

    const calls: Array<Record<string, any>> = [];
    const fileTool = {
      name: 'file',
      description: 'file ops',
      parameters: [
        { name: 'action', type: 'string', description: 'a', required: true },
        { name: 'path', type: 'string', description: 'p', required: true },
      ],
      async execute(params: any) {
        calls.push(params);
        if (params.action === 'write' && !params.content) {
          // Mirror the real FileTool runtime guard: a write without content
          // soft-fails (this is what arms the guard in round 1).
          return { success: false, error: '[PARAM_ERROR] file write requires a non-empty content string.' };
        }
        if (params.action === 'delete') {
          calls[calls.length - 1].deleted = true; // would really delete
        }
        return { success: true, output: `did ${params.action}` };
      },
    };

    // Scripted provider: round 1 write with EMPTY content (soft fail),
    // round 2 a delete against the same path, round 3 plain text answer.
    const provider = {
      name: 'fake',
      chat: async () => ({ content: '', role: 'assistant' as const }),
      buildTools: () => [],
      rounds: [
        [
          {
            type: 'tool_calls',
            toolCalls: [{
              id: 'c1', type: 'function',
              function: { name: 'file', arguments: '{"action":"write","path":"victim.txt"}' },
            }],
          },
        ],
        [
          {
            type: 'tool_calls',
            toolCalls: [{
              id: 'c2', type: 'function',
              function: { name: 'file', arguments: '{"action":"delete","path":"victim.txt"}' },
            }],
          },
        ],
        [{ type: 'text', content: 'done' }],
      ],
      async *chatStream(messages: any) {
        const chunks = this.rounds[Math.min(this.i, this.rounds.length - 1)];
        this.i++;
        for (const c of chunks) yield c;
        return { content: '', role: 'assistant' as const };
      },
      i: 0,
    } as any;

    const svc = new LLMService(provider as any, 'k', 'm');
    svc.registerTools([fileTool as any]);

    const iter = svc.chatStream([{ role: 'user', content: 'rename' }] as type.ChatMessage[]);
    let next = await iter.next();
    const roundResults: any[] = [];
    while (!next.done) {
      if (next.value.type === 'tool_calls' && !(next.value as any).pending) {
        roundResults.push((next.value as any).results?.[0]);
      }
      next = await iter.next();
    }

    // Round 1: write failed (missing content -> PARAM_ERROR).
    expect(roundResults[0].ok).toBe(false);
    // Round 2: the delete must be BLOCKED by the session-scoped guard —
    // the round-8 finding was that this block expired with the turn.
    expect(roundResults[1].ok).toBe(false);
    expect(roundResults[1].output).toMatch(/DATA_GUARD/);
    expect(calls.some(c => c.deleted)).toBe(false);
  });
});

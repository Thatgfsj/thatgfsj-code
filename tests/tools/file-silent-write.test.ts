/**
 * v3.5.0 regression tests for the field-report findings:
 *  - file write with a missing content param must FAIL (no more 0-byte
 *    files reported as success)
 *  - a successful write reports its byte count
 *  - reading an empty file says so instead of returning output:""
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileTool } from '../../src/tools/file.js';

describe('file tool: silent-write-failure regressions', () => {
  let dir: string;
  let tool: FileTool;
  // Auto-accept context — permission gating is covered elsewhere; these
  // tests target the payload validation and result semantics.
  const ctx = {
    confirmEdit: async () => true,
    confirmAction: async () => true,
  } as any;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nwt-file-'));
    tool = new FileTool();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects write without content and does NOT create the file', async () => {
    const p = join(dir, 'note.txt');
    const r = await tool.execute({ action: 'write', path: p }, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/content/i);
    expect(existsSync(p)).toBe(false);
  });

  it('rejects write with empty-string content', async () => {
    const p = join(dir, 'note.txt');
    const r = await tool.execute({ action: 'write', path: p, content: '' }, ctx);
    expect(r.success).toBe(false);
    expect(existsSync(p)).toBe(false);
  });

  it('reports byte count on success', async () => {
    const p = join(dir, 'note.txt');
    const r = await tool.execute({ action: 'write', path: p, content: 'hello' }, ctx);
    expect(r.success).toBe(true);
    expect(r.output).toContain('5 bytes');
    expect(statSync(p).size).toBe(5);
  });

  it('reading an empty file reports emptiness instead of output:""', async () => {
    const p = join(dir, 'empty.txt');
    writeFileSync(p, '', 'utf-8');
    const r = await tool.execute({ action: 'read', path: p }, ctx);
    expect(r.success).toBe(true);
    expect(r.output).toContain('empty file');
    expect(r.output).toContain('0 bytes');
  });

  it('schema marks content as required so the agent loop pre-validates', () => {
    expect(tool.inputSchema.required).toContain('content');
    expect(tool.parameters.find(p => p.name === 'content')?.required).toBe(true);
  });
});

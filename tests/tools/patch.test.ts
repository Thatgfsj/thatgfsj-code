import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ApplyPatchTool, parsePatch, PatchParseError } from '../../src/tools/patch.js';

let tmp: string;
const tool = new ApplyPatchTool();

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gfcode-patch-'));
});

afterAll(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

const patch = (body: string) => `*** Begin Patch\n${body}\n*** End Patch`;

describe('parsePatch (Codex V4A grammar)', () => {
  it('parses add / update / delete sections', () => {
    const files = parsePatch(patch([
      '*** Add File: new.ts',
      '+export const x = 1;',
      '*** Update File: src/app.ts',
      '@@ keep',
      ' context',
      '-old',
      '+new',
      '*** Delete File: old.ts',
    ].join('\n')));
    expect(files.map(f => f.kind)).toEqual(['add', 'update', 'delete']);
    // '@@ keep' anchor becomes a locating context line (Codex semantics)
    expect(files[1].hunks[0].changes.map(c => c.type)).toEqual(['context', 'context', 'remove', 'add']);
  });

  it('rejects missing Begin marker and unknown lines', () => {
    expect(() => parsePatch('*** Add File: a\n+x')).toThrow(PatchParseError);
    expect(() => parsePatch(patch('hello world'))).toThrow(/文件操作之外/);
  });

  it('rejects duplicate paths and empty patches', () => {
    expect(() => parsePatch(patch([
      '*** Add File: a.ts',
      '+x',
      '*** Add File: a.ts',
      '+y',
    ].join('\n')))).toThrow(/出现两次/);
    expect(() => parsePatch(patch(''))).toThrow(/补丁为空/);
  });
});

describe('ApplyPatchTool end-to-end', () => {
  it('updates a file with an exact-context hunk; ONE confirm for the whole patch', async () => {
    const f = join(tmp, 'app.ts');
    writeFileSync(f, 'function main() {\n  console.log("old");\n}\n', 'utf-8');
    let confirms = 0;
    const r = await tool.execute({
      patch: patch([
        '*** Update File: app.ts',
        '@@',
        ' function main() {',
        '-  console.log("old");',
        '+  console.log("new");',
        ' }',
      ].join('\n')),
    }, { workingDirectory: tmp, confirmAction: async () => { confirms++; return true; } });
    expect(r.success).toBe(true);
    expect(confirms).toBe(1);
    expect(readFileSync(f, 'utf-8')).toContain('console.log("new")');
    expect(readFileSync(f, 'utf-8')).not.toContain('"old"');
  });

  it('tolerates trailing-whitespace drift in context lines', async () => {
    const f = join(tmp, 'ws.txt');
    writeFileSync(f, 'alpha  \nbeta\n', 'utf-8');
    const r = await tool.execute({
      patch: patch([
        '*** Update File: ws.txt',
        '@@',
        ' alpha',
        '-beta',
        '+beta 2',
      ].join('\n')),
    }, { workingDirectory: tmp, confirmAction: async () => true });
    expect(r.success).toBe(true);
    expect(readFileSync(f, 'utf-8')).toBe('alpha  \nbeta 2\n');
  });

  it('fails with [PATCH_ERROR] and leaves the file untouched when context does not match', async () => {
    const f = join(tmp, 'nomatch.txt');
    const before = 'line one\nline two\n';
    writeFileSync(f, before, 'utf-8');
    const r = await tool.execute({
      patch: patch([
        '*** Update File: nomatch.txt',
        '@@',
        ' not in the file',
        '-also missing',
        '+x',
      ].join('\n')),
    }, { workingDirectory: tmp, confirmAction: async () => true });
    expect(r.success).toBe(false);
    expect(r.error).toContain('[PATCH_ERROR]');
    expect(readFileSync(f, 'utf-8')).toBe(before);
  });

  it('applies add + delete atomically with a single confirmation', async () => {
    const gone = join(tmp, 'gone.txt');
    writeFileSync(gone, 'bye\n', 'utf-8');
    const created = join(tmp, 'nested', 'new.ts');
    let confirms = 0;
    const r = await tool.execute({
      patch: patch([
        '*** Add File: nested/new.ts',
        '+export {};',
        '*** Delete File: gone.txt',
      ].join('\n')),
    }, { workingDirectory: tmp, confirmAction: async () => { confirms++; return true; } });
    expect(r.success).toBe(true);
    expect(confirms).toBe(1);
    expect(existsSync(created)).toBe(true);
    expect(existsSync(gone)).toBe(false);
  });

  it('declined confirmation writes nothing', async () => {
    const f = join(tmp, 'declined.txt');
    writeFileSync(f, 'original\n', 'utf-8');
    const r = await tool.execute({
      patch: patch(['*** Update File: declined.txt', '@@', ' original', '-original', '+changed'].join('\n')),
    }, { workingDirectory: tmp, confirmAction: async () => false });
    expect(r.success).toBe(false);
    expect(readFileSync(f, 'utf-8')).toBe('original\n');
  });

  it('fails closed without a confirmation channel', async () => {
    const r = await tool.execute({
      patch: patch(['*** Add File: nochan.txt', '+x'].join('\n')),
    }, { workingDirectory: tmp });
    expect(r.success).toBe(false);
    expect(existsSync(join(tmp, 'nochan.txt'))).toBe(false);
  });

  it('Add File on an existing path is an error', async () => {
    writeFileSync(join(tmp, 'exists.txt'), 'x', 'utf-8');
    const r = await tool.execute({
      patch: patch(['*** Add File: exists.txt', '+y'].join('\n')),
    }, { workingDirectory: tmp, confirmAction: async () => true });
    expect(r.success).toBe(false);
    expect(r.error).toContain('已存在');
  });

  it('Update File on a missing file is an error', async () => {
    const r = await tool.execute({
      patch: patch(['*** Update File: missing.txt', '@@', ' a', '-a', '+b'].join('\n')),
    }, { workingDirectory: tmp, confirmAction: async () => true });
    expect(r.success).toBe(false);
    expect(r.error).toContain('不存在');
  });

  it('preserves CRLF line endings on Windows files', async () => {
    const f = join(tmp, 'crlf.txt');
    writeFileSync(f, 'one\r\ntwo\r\nthree\r\n', 'utf-8');
    const r = await tool.execute({
      patch: patch(['*** Update File: crlf.txt', '@@', ' two', '-three', '+THREE'].join('\n')),
    }, { workingDirectory: tmp, confirmAction: async () => true });
    expect(r.success).toBe(true);
    expect(readFileSync(f, 'utf-8')).toBe('one\r\ntwo\r\nTHREE\r\n');
  });

  it('Move to renames the patched file', async () => {
    const oldF = join(tmp, 'before.ts');
    writeFileSync(oldF, '// header\nconst a = 1;\n// footer\n', 'utf-8');
    const r = await tool.execute({
      patch: patch([
        '*** Update File: before.ts',
        '*** Move to: after.ts',
        '@@',
        ' // header',
        '-const a = 1;',
        '+const a = 2;',
        ' // footer',
      ].join('\n')),
    }, { workingDirectory: tmp, confirmAction: async () => true });
    expect(r.success).toBe(true);
    expect(existsSync(oldF)).toBe(false);
    expect(readFileSync(join(tmp, 'after.ts'), 'utf-8')).toBe('// header\nconst a = 2;\n// footer\n');
  });
});

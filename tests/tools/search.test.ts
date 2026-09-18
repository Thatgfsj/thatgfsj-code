import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SearchTool } from '../../src/tools/search.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gfcode-search-'));
  mkdirSync(join(tmp, 'sub'));
  writeFileSync(join(tmp, 'a.txt'), 'hello world\nUNICODE café\n');
  writeFileSync(join(tmp, 'sub', 'b.ts'), 'const greeting = "hello"; // (greet)\nconst x = 1;\n');
  writeFileSync(join(tmp, 'skip-me.log'), 'hello from logs\n');
  // ignored dir
  mkdirSync(join(tmp, 'node_modules'));
  writeFileSync(join(tmp, 'node_modules', 'c.js'), 'hello from node_modules\n');
});

afterAll(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('SearchTool.grep (v3.0.5 pure-JS, Windows-safe)', () => {
  const tool = new SearchTool();

  it('finds matches with file:line prefix', async () => {
    const r = await tool.execute({ action: 'grep', pattern: 'hello', path: tmp, options: '' });
    expect(r.success).toBe(true);
    expect(r.output).toContain('a.txt:1: hello world');
    expect(r.output).toContain('b.ts:1:');
  });

  it('skips ignored directories and dot-files', async () => {
    const r = await tool.execute({ action: 'grep', pattern: 'node_modules', path: tmp, options: '' });
    expect(r.success).toBe(true);
    expect(r.output).not.toContain('c.js');
  });

  it('case-insensitive option works', async () => {
    const r = await tool.execute({ action: 'grep', pattern: 'unicode', path: tmp, options: 'i' });
    expect(r.success).toBe(true);
    expect(r.output).toContain('café');
  });

  it('treats invalid regex as a literal pattern', async () => {
    // `(greet` is an invalid regex (unclosed group) but exists literally
    // inside the `// (greet)` comment line.
    const r = await tool.execute({ action: 'grep', pattern: '(greet', path: tmp, options: '' });
    expect(r.success).toBe(true);
    expect(r.output).toContain('b.ts');
  });

  it('files-only mode lists file paths', async () => {
    const r = await tool.execute({ action: 'grep', pattern: 'hello', path: tmp, options: 'l' });
    expect(r.success).toBe(true);
    expect(r.output).toContain('a.txt');
    expect(r.output).not.toContain('a.txt:1:');
  });
});

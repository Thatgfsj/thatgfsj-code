import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, existsSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ShellTool, isReadOnlyCommand } from '../../src/tools/shell.js';

let tmp: string;
const tool = new ShellTool();

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gfcode-shell-'));
});

afterAll(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('isReadOnlyCommand classification (v3.0.20 Codex grading)', () => {
  it('allows inspection commands', () => {
    expect(isReadOnlyCommand('ls')).toBe(true);
    expect(isReadOnlyCommand('git status')).toBe(true);
    expect(isReadOnlyCommand('git log --oneline -5')).toBe(true);
    expect(isReadOnlyCommand('git diff HEAD~1')).toBe(true);
    expect(isReadOnlyCommand('node --version')).toBe(true);
    expect(isReadOnlyCommand('npm ls')).toBe(true);
    expect(isReadOnlyCommand('git config --get user.name')).toBe(true);
  });

  it('blocks anything that writes, redirects, or executes', () => {
    expect(isReadOnlyCommand('echo hi > file.txt')).toBe(false);
    expect(isReadOnlyCommand('git push')).toBe(false);
    expect(isReadOnlyCommand('git commit -m x')).toBe(false);
    expect(isReadOnlyCommand('git branch feature-x')).toBe(false);
    expect(isReadOnlyCommand('git config user.name x')).toBe(false);
    expect(isReadOnlyCommand('node script.js')).toBe(false);
    expect(isReadOnlyCommand('npm run build')).toBe(false);
    expect(isReadOnlyCommand('npm install left-pad')).toBe(false);
    expect(isReadOnlyCommand('rm file.txt')).toBe(false);
  });

  it('every segment of a chained command must be read-only', () => {
    expect(isReadOnlyCommand('git status && git log')).toBe(true);
    expect(isReadOnlyCommand('git status && npm install x')).toBe(false);
  });
});

describe('ShellTool graded approval', () => {
  it('runs read-only commands WITHOUT a confirmation channel', async () => {
    const r = await tool.execute({ command: 'echo readonly-ok' }, { workingDirectory: tmp });
    expect(r.success).toBe(true);
    expect(r.output).toContain('readonly-ok');
  });

  it('still asks for write commands; declined = not executed', async () => {
    const target = join(tmp, 'made-by-shell.txt');
    const asks: string[] = [];
    const r = await tool.execute(
      { command: `node -e "require('fs').writeFileSync(process.argv[1],'x')" "${target}"` },
      { workingDirectory: tmp, confirmAction: async (msg) => { asks.push(msg); return false; } },
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain('cancelled');
    expect(asks.length).toBe(1);
    expect(existsSync(target)).toBe(false);
  });

  it('write command proceeds when confirmed', async () => {
    const target = join(tmp, 'confirmed.txt');
    const r = await tool.execute(
      { command: `node -e "require('fs').writeFileSync(process.argv[1],'ok')" "${target}"` },
      { workingDirectory: tmp, confirmAction: async () => true },
    );
    expect(r.success).toBe(true);
    expect(existsSync(target)).toBe(true);
  });

  it('write command fails closed with no confirmation channel', async () => {
    const nochan = join(tmp, 'nochan.txt');
    const r = await tool.execute(
      { command: `node -e "require('fs').writeFileSync(process.argv[1],'x')" "${nochan}"` },
      { workingDirectory: tmp },
    );
    expect(r.success).toBe(false);
    expect(existsSync(nochan)).toBe(false);
  });

  it('truncates huge output with a marker (context protection)', async () => {
    const r = await tool.execute(
      { command: `node -e "console.log('x'.repeat(20000))"` },
      { workingDirectory: tmp, confirmAction: async () => true },
    );
    expect(r.success).toBe(true);
    expect((r.output || '').length).toBeLessThan(9000);
    expect(r.output).toContain('输出截断');
  });

  it('dangerous commands stay hard-blocked regardless of classification', async () => {
    const r = await tool.execute({ command: 'rm -rf /' }, { workingDirectory: tmp, confirmAction: async () => true });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Blocked');
  });
});

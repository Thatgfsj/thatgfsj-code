import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileTool } from '../../src/tools/file.js';
import { ShellTool } from '../../src/tools/shell.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gfcode-perm-'));
});

afterAll(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('FileTool permission gate (v3.0.5)', () => {
  it('write asks via confirmEdit and shows a diff; declined = not written', async () => {
    const target = join(tmp, 'declined.txt');
    writeFileSync(target, 'old line\n', 'utf-8');
    const asks: string[] = [];
    const tool = new FileTool();
    const r = await tool.execute(
      { action: 'write', path: target, content: 'new line\n' },
      {
        confirmAction: async () => true,
        confirmEdit: async (info) => {
          asks.push(info.message);
          return false;
        },
      },
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain('cancelled');
    expect(readFileSync(target, 'utf-8')).toBe('old line\n');
    expect(asks[0]).toContain('declined.txt');
    expect(asks[0]).toContain('- old line');
    expect(asks[0]).toContain('+ new line');
  });

  it('write proceeds when confirmEdit allows', async () => {
    const target = join(tmp, 'allowed.txt');
    const tool = new FileTool();
    const r = await tool.execute(
      { action: 'write', path: target, content: 'data\n' },
      { confirmAction: async () => true, confirmEdit: async () => true },
    );
    expect(r.success).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('data\n');
  });

  it('write fails closed when no confirmation channel exists', async () => {
    const target = join(tmp, 'no-channel.txt');
    const tool = new FileTool();
    const r = await tool.execute({ action: 'write', path: target, content: 'x' }, {});
    expect(r.success).toBe(false);
    expect(existsSync(target)).toBe(false);
  });

  it('read does not require confirmation', async () => {
    const target = join(tmp, 'allowed.txt');
    const tool = new FileTool();
    const r = await tool.execute({ action: 'read', path: target }, {});
    expect(r.success).toBe(true);
  });

  it('delete asks via confirmAction; declined = still there', async () => {
    const target = join(tmp, 'todelete.txt');
    writeFileSync(target, 'x', 'utf-8');
    const tool = new FileTool();
    const r = await tool.execute(
      { action: 'delete', path: target },
      { confirmAction: async () => false },
    );
    expect(r.success).toBe(false);
    expect(existsSync(target)).toBe(true);
  });
});

describe('ShellTool permission gate (v3.0.5)', () => {
  it('fails closed without a confirmation channel', async () => {
    const tool = new ShellTool();
    const r = await tool.execute({ command: 'echo hi' }, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('--yolo');
  });

  it('blocked dangerous commands never reach confirmation', async () => {
    const tool = new ShellTool();
    let asked = false;
    const r = await tool.execute(
      { command: 'rm -rf /' },
      { confirmAction: async () => { asked = true; return true; } },
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain('Blocked');
    expect(asked).toBe(false);
  });

  it('runs when the user confirms', async () => {
    const tool = new ShellTool();
    const cmd = process.platform === 'win32' ? 'echo ok-from-test' : 'echo ok-from-test';
    const r = await tool.execute({ command: cmd }, { confirmAction: async () => true });
    expect(r.success).toBe(true);
    expect(r.output).toContain('ok-from-test');
  });
});

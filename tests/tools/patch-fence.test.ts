// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, symlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ApplyPatchTool } from '../../src/tools/patch.js';

/**
 * v3.5.4 regressions: apply_patch workspace fence + symlink hardening.
 */
describe('apply_patch workspace fence', () => {
  let proj: string;
  let outside: string;
  let tool: ApplyPatchTool;
  const ctx = () => ({
    confirmAction: async () => true,
    workingDirectory: proj,
  }) as any;

  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'nwt-patchfence-'));
    outside = mkdtempSync(join(tmpdir(), 'nwt-patchout-'));
    tool = new ApplyPatchTool();
  });

  afterEach(() => {
    for (const d of [proj, outside]) rmSync(d, { recursive: true, force: true });
  });

  it('refuses Add File targeting outside the workspace, before any write', async () => {
    const outsideFile = join(outside, 'evil.txt');
    const patch = [
      '*** Begin Patch',
      `*** Add File: ${outsideFile}`,
      '+pwned',
      '*** End Patch',
    ].join('\n');
    const r = await tool.execute({ patch }, ctx());
    expect(r.success).toBe(false);
    expect(String(r.error)).toMatch(/WORKSPACE/);
    expect(existsSync(outsideFile)).toBe(false);
  });

  it('refuses relative ../ escapes', async () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: ../escaped.txt',
      '+pwned',
      '*** End Patch',
    ].join('\n');
    const r = await tool.execute({ patch }, ctx());
    expect(r.success).toBe(false);
    expect(String(r.error)).toMatch(/WORKSPACE/);
    expect(existsSync(join(proj, '..', 'escaped.txt'))).toBe(false);
  });

  it('a symlink pointing outside is caught (resolve() alone cannot see it)', async () => {
    // A symlink INSIDE proj that resolves OUTSIDE it.
    const link = join(proj, 'link.txt');
    const outsideFile = join(outside, 'target.txt');
    writeFileSync(outsideFile, 'original', 'utf-8');
    try {
      symlinkSync(outsideFile, link);
    } catch {
      return; // Windows may need privileges for symlinks — skip quietly
    }
    const patch = [
      '*** Begin Patch',
      '*** Update File: link.txt',
      '@@',
      '-original',
      '+pwned',
      '*** End Patch',
    ].join('\n');
    const r = await tool.execute({ patch }, ctx());
    expect(r.success).toBe(false);
    expect(String(r.error)).toMatch(/WORKSPACE/);
    expect(readFileSync(outsideFile, 'utf-8')).toBe('original'); // untouched
  });

  it('in-workspace patches still apply normally', async () => {
    writeFileSync(join(proj, 'a.txt'), 'hello\n', 'utf-8');
    const patch = [
      '*** Begin Patch',
      '*** Update File: a.txt',
      '@@',
      '-hello',
      '+world',
      '*** End Patch',
    ].join('\n');
    const r = await tool.execute({ patch }, ctx());
    expect(r.success).toBe(true);
    expect(readFileSync(join(proj, 'a.txt'), 'utf-8')).toContain('world');
  });
});

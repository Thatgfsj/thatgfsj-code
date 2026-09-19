import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SystemPromptBuilder } from '../src/prompts/index.js';

let root: string;
let home: string;
let prevUserProfile: string | undefined;
let prevHome: string | undefined;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gfcode-agents-'));
  home = join(root, 'home');
  mkdirSync(join(home, '.thatgfsj'), { recursive: true });
  mkdirSync(join(root, 'repo', 'sub'), { recursive: true });

  writeFileSync(join(home, '.thatgfsj', 'AGENTS.md'), 'GLOBAL-INSTRUCTION v3.0.20\n', 'utf-8');
  writeFileSync(join(root, 'repo', 'AGENTS.md'), 'REPO-ROOT-INSTRUCTION\n', 'utf-8');
  writeFileSync(join(root, 'repo', 'sub', 'AGENTS.md'), 'CWD-INSTRUCTION\n', 'utf-8');

  // The builder reads USERPROFILE/HOME at build time — point both at the
  // fixture home so the global chain is hermetic.
  prevUserProfile = process.env.USERPROFILE;
  prevHome = process.env.HOME;
  process.env.USERPROFILE = home;
  process.env.HOME = home;
});

afterAll(() => {
  if (prevUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUserProfile;
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('AGENTS.md discovery chain (Codex parity)', () => {
  it('injects global → ancestor → cwd instructions in that order, deduped', () => {
    const cwd = join(root, 'repo', 'sub');
    const built = new SystemPromptBuilder({ cwd, includeProjectMd: true }).build();
    expect(built).toContain('GLOBAL-INSTRUCTION v3.0.20');
    expect(built).toContain('REPO-ROOT-INSTRUCTION');
    expect(built).toContain('CWD-INSTRUCTION');

    const section = built.slice(built.indexOf('## User Configuration'));
    expect(section.indexOf('GLOBAL-INSTRUCTION')).toBeLessThan(section.indexOf('REPO-ROOT-INSTRUCTION'));
    expect(section.indexOf('REPO-ROOT-INSTRUCTION')).toBeLessThan(section.indexOf('CWD-INSTRUCTION'));
    // cwd AGENTS.md must appear exactly once (ancestor walk + cwd list dedupe).
    expect(section.match(/CWD-INSTRUCTION/g)?.length).toBe(1);
  });

  it('caps each file at 3000 chars with a truncation marker', () => {
    const cwd = join(root, 'repo', 'sub');
    writeFileSync(join(cwd, 'CONVENTIONS.md'), 'x'.repeat(5000), 'utf-8');
    const built = new SystemPromptBuilder({ cwd, includeProjectMd: true }).build();
    const section = built.slice(built.indexOf('## User Configuration'));
    expect(section).toContain('... (truncated)');
    expect(section.indexOf('x'.repeat(3000))).toBeGreaterThanOrEqual(0);
    expect(section.includes('x'.repeat(3001))).toBe(false);
  });

  it('project with no instruction files only gets the global layer', () => {
    const emptyDir = join(root, 'empty-proj');
    mkdirSync(emptyDir, { recursive: true });
    const built = new SystemPromptBuilder({ cwd: emptyDir, includeProjectMd: true }).build();
    expect(built).toContain('GLOBAL-INSTRUCTION v3.0.20'); // global chain still applies
    expect(built).not.toContain('REPO-ROOT-INSTRUCTION');
    expect(built).not.toContain('CWD-INSTRUCTION');
    const cwd = join(root, 'repo', 'sub');
    expect(new SystemPromptBuilder({ cwd, includeProjectMd: false }).build()).not.toContain('## User Configuration');
  });
});

describe('permission-mode prompt sections (v3.1.0 modes)', () => {
  it('plan mode instructs read-only research + plan + stop', () => {
    const cwd = join(root, 'repo', 'sub');
    const built = new SystemPromptBuilder({ cwd, includeProjectMd: false, permissionMode: 'plan' }).build();
    expect(built).toContain('Current mode: plan');
    expect(built).toContain('PLAN MODE');
    expect(built).toContain('AUTO-DENIED');
    expect(built).toContain('update_plan');
  });

  it('accept mode documents full permission; ask mode documents grading', () => {
    const cwd = join(root, 'repo', 'sub');
    const accept = new SystemPromptBuilder({ cwd, includeProjectMd: false, permissionMode: 'accept' }).build();
    expect(accept).toContain('FULL PERMISSION MODE');
    const ask = new SystemPromptBuilder({ cwd, includeProjectMd: false, permissionMode: 'ask' }).build();
    expect(ask).toContain('Read-only commands');
  });
});

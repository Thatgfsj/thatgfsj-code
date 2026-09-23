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

describe('estimateBreakdown (v3.2.0 context panel)', () => {
  const tools = [
    {
      name: 'shell',
      description: 'run a shell command with a very long documentation block so its schema clearly dominates',
      parameters: [
        { name: 'command', type: 'string' as const, description: 'the command line to execute', required: true },
      ],
    },
    { name: 'mcp__srv__ping', description: 'p', parameters: [] },
  ];

  it('splits tools vs mcp tools vs skills; tool text stays out of the prompt bucket', async () => {
    const cwd = join(root, 'repo', 'sub');
    const { SystemPromptBuilder } = await import('../src/prompts/index.js');
    const b = new SystemPromptBuilder({
      cwd, tools, includeProjectMd: true, skillsPrompt: 'SKILL-TEXT '.repeat(40),
    });
    const bd = b.estimateBreakdown();
    expect(bd.systemTools).toBeGreaterThan(0);
    expect(bd.mcpTools).toBeGreaterThan(0);
    expect(bd.systemTools).toBeGreaterThan(bd.mcpTools); // shell schema dominates
    expect(bd.skills).toBeGreaterThan(0);
    // Exclusion proof: tool-instructions live in the tool buckets, so a
    // huge tool DESCRIPTION must not move the prompt bucket at all.
    // v3.5.4 note: the identity segment now lists tool NAMES dynamically,
    // so the no-tools baseline legitimately differs; the invariant under
    // test is description-independence with the same tool set.
    const huge = [
      { ...tools[0], description: 'A'.repeat(2000) },
      { ...tools[1] },
    ];
    const withTools = new SystemPromptBuilder({ cwd, tools: huge, includeProjectMd: false }).estimateBreakdown();
    const sameNames = new SystemPromptBuilder({ cwd, tools, includeProjectMd: false }).estimateBreakdown();
    // Description-independence: a bigger tool description lands ONLY in the
    // toolInstructions bucket; systemPrompt stays byte-identical.
    expect(withTools.systemPrompt).toBe(sameNames.systemPrompt);
    expect(withTools.toolInstructions).toBeGreaterThan(sameNames.toolInstructions);
    // The schema bucket grows with the description (it rides the wire).
    expect(withTools.systemTools).toBeGreaterThan(sameNames.systemTools);
    const noTools = new SystemPromptBuilder({ cwd, tools: [], includeProjectMd: false }).estimateBreakdown();
    expect(withTools.systemTools).toBeGreaterThan(noTools.systemTools);
  });

  it('counts zero for absent sections', async () => {
    const cwd = join(root, 'repo', 'sub');
    const { SystemPromptBuilder } = await import('../src/prompts/index.js');
    const b = new SystemPromptBuilder({ cwd, tools: [], includeProjectMd: false, skillsPrompt: '' });
    const bd = b.estimateBreakdown();
    expect(bd.systemTools).toBeLessThanOrEqual(1); // empty [] still serializes to '[]' → estimate floor of 1
    expect(bd.mcpTools).toBeLessThanOrEqual(1);
    expect(bd.skills).toBe(0);
    expect(bd.systemPrompt).toBeGreaterThan(0); // identity + env still present
  });
});

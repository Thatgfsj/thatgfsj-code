// @vitest-environment node
/** @jsxImportSource react */
import React from 'react';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { render } from 'ink-testing-library';
import { TuiErrorBoundary } from '../../src/tui/components/ErrorBoundary.js';
import { reportCrash } from '../../src/utils/crash.js';

/**
 * v3.2.0: TUI render errors are swallowed by Ink's reconciler and never
 * reach the process-level uncaughtException handlers — the PlanPanel crash
 * therefore produced NO last-error.log and was undiagnosable from user
 * pastes alone. The boundary is the fix's second half: prove a render throw
 * (a) paints a readable line and (b) lands the full stack on disk.
 */

let root: string;
let prevUserProfile: string | undefined;
let prevHome: string | undefined;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gfcode-crash-'));
  mkdirSync(join(root, '.thatgfsj'), { recursive: true });
  prevUserProfile = process.env.USERPROFILE;
  prevHome = process.env.HOME;
  process.env.USERPROFILE = root;
  process.env.HOME = root;
});

afterAll(() => {
  if (prevUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUserProfile;
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

function Boom(): null {
  throw new Error('boom-items');
}

describe('TuiErrorBoundary + reportCrash', () => {
  it('reportCrash appends a timestamped stack to ~/.thatgfsj/last-error.log', () => {
    const logPath = join(root, '.thatgfsj', 'last-error.log');
    if (existsSync(logPath)) rmSync(logPath);
    reportCrash('test-kind', new Error('crash-of-test'));
    const txt = readFileSync(logPath, 'utf-8');
    expect(txt).toContain('test-kind');
    expect(txt).toContain('crash-of-test');
    expect(txt).toContain('    at '); // real stack frames, not just the message
  });

  it('catches a render throw, paints a readable line and writes the stack', () => {
    const logPath = join(root, '.thatgfsj', 'last-error.log');
    if (existsSync(logPath)) rmSync(logPath);
    const { lastFrame } = render(
      <TuiErrorBoundary autoExit={false}>
        <Boom />
      </TuiErrorBoundary>
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('界面渲染出错');
    expect(frame).toContain('boom-items');
    const txt = readFileSync(logPath, 'utf-8');
    expect(txt).toContain('tui-render');
    expect(txt).toContain('boom-items');
  });
});

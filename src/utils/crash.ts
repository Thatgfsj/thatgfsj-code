/**
 * v3.2.0: shared crash reporter (was private to cmd/index.tsx).
 *
 * The TUI error boundary needs it too: React render errors are caught by
 * the reconciler and NEVER reach the process-level uncaughtException /
 * unhandledRejection hooks — a TUI crash therefore produced no
 * last-error.log at all (exactly what happened with the PlanPanel
 * 'items' crash reports: message-only pastes, no stack, nothing on disk).
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getVersion } from '../version.js';

export function reportCrash(kind: string, error: unknown, componentStack?: string): void {
  const stack = error instanceof Error ? (error.stack || error.message) : String(error);
  try {
    const dir = join(homedir(), '.thatgfsj');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const log = [
      `--- ${new Date().toISOString()} · ${kind} · v${getVersion()} ---`,
      stack,
      componentStack ? `component stack:\n${componentStack}` : '',
      '',
    ].filter(l => l !== '').join('\n') + '\n';
    appendFileSync(join(dir, 'last-error.log'), log, 'utf-8');
  } catch { /* best-effort — never let logging break exiting */ }
  try {
    // stderr: keeps stdout clean for --json consumers and Ink frames.
    process.stderr.write(`\n  Error (${kind}): ${stack}\n`);
  } catch { /* stdout gone — still have the file */ }
}

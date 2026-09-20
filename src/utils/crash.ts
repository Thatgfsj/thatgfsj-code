/**
 * v3.2.0: shared crash reporter (was private to cmd/index.tsx).
 *
 * The TUI error boundary needs it too: React render errors are caught by
 * the reconciler and NEVER reach the process-level uncaughtException /
 * unhandledRejection hooks — a TUI crash therefore produced no
 * last-error.log at all (exactly what happened with the PlanPanel
 * 'items' crash reports: message-only pastes, no stack, nothing on disk).
 */

import { appendFileSync, existsSync, mkdirSync, statSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getVersion } from '../version.js';

/** v3.4.0: keep last-error.log bounded — truncate to the tail when it
 * exceeds 200 KB so years of crashes cannot grow it unbounded. */
const MAX_LOG_BYTES = 200 * 1024;

export function reportCrash(kind: string, error: unknown, componentStack?: string): void {
  const stack = error instanceof Error ? (error.stack || error.message) : String(error);
  try {
    const dir = join(homedir(), '.thatgfsj');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = join(dir, 'last-error.log');
    try {
      if (existsSync(path) && statSync(path).size > MAX_LOG_BYTES) {
        // Simple bound: drop the old log entirely rather than parse/rotate.
        rmSync(path);
      }
    } catch { /* rotation is best-effort */ }
    const log = [
      `--- ${new Date().toISOString()} · ${kind} · v${getVersion()} ---`,
      stack,
      componentStack ? `component stack:\n${componentStack}` : '',
      '',
    ].filter(l => l !== '').join('\n') + '\n';
    appendFileSync(path, log, 'utf-8');
  } catch { /* best-effort — never let logging break exiting */ }
  try {
    // stderr: keeps stdout clean for --json consumers and Ink frames.
    process.stderr.write(`\n  Error (${kind}): ${stack}\n`);
  } catch { /* stdout gone — still have the file */ }
}

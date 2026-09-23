/**
 * Workspace fence — shared by the mutating file tools (file, write_file,
 * apply_patch has its own plan-time variant).
 *
 * v3.5.3: prefix containment. v3.5.4: symlink-hardened — resolve() alone
 * does not follow links, so `proj/link.txt -> /etc/target` slipped past a
 * plain prefix check. The containment test walks the deepest EXISTING
 * ancestor of the target with realpathSync and compares against the
 * realpath of the workspace root.
 *
 * Known limitation (DEVELOPMENT.md): HARD links resolve to themselves and
 * are not detectable this way; (dev,ino) comparison was rejected for cost.
 */

import { realpathSync } from 'fs';
import { resolve, sep, dirname } from 'path';
import type { ToolResult, ToolContext } from './types.js';

/**
 * v3.5.4 (field report, round 7): Windows false positives.
 * - Case variants (`C:\Proj` vs `c:\proj`): NTFS is case-insensitive but
 *   string comparison is not — fold case on win32.
 * - `\\?\` extended-length prefixes: strip before comparing (realpath
 *   keeps them on some Node builds).
 */
function normalizeForCompare(p: string): string {
  let s = p;
  if (s.startsWith('\\\?\\')) s = s.slice(4);
  if (s.startsWith('/??/')) s = s.slice(4);
  return process.platform === 'win32' ? s.toLowerCase() : s;
}

function realOfDeepestExisting(p: string): string {
  let cur = resolve(p);
  for (;;) {
    try {
      return realpathSync(cur);
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return cur;
      cur = parent;
    }
  }
}

/** True when `path` (symlink-resolved) stays inside `root`. */
export function isInsideWorkspace(root: string, path: string): boolean {
  const rootReal = normalizeForCompare(realOfDeepestExisting(root));
  const targetReal = normalizeForCompare(realOfDeepestExisting(path));
  return targetReal === rootReal || targetReal.startsWith(rootReal + sep);
}

/**
 * Containment check for mutating actions. Returns a [WORKSPACE] refusal
 * when ctx carries a workingDirectory and the path escapes it; null when
 * allowed (including "no ctx" — tests/direct use skip the fence).
 */
export function assertWorkspacePath(
  action: string,
  path: string,
  ctx?: ToolContext,
): ToolResult | null {
  if (!ctx?.workingDirectory) return null;
  if (isInsideWorkspace(ctx.workingDirectory, path)) return null;
  return {
    success: false,
    error: `[WORKSPACE] "${action}" may only touch files inside the project directory (${ctx.workingDirectory}). Target was outside: ${path}. If this is genuinely required, ask the user or use the shell tool (it asks for confirmation).`,
  };
}

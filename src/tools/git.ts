/**
 * Git Tool - Git operations
 *
 * v3.0.5:
 *   - Command injection fixed: user/model-controlled values (commit
 *     messages, branch names, extra args) were interpolated into a shell
 *     string executed via cmd.exe. All calls now go through execFile with
 *     an argument array, so values are passed verbatim and never parsed
 *     by a shell.
 *   - Write actions (commit/push/pull/checkout/add) require confirmation
 *     via ctx.confirmAction; read-only actions (status/log/diff/branch)
 *     run silently. App.requestConfirmation owns the mode decision.
 */

import type { Tool, ToolResult, ToolContext } from './types.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';

const execFileAsync = promisify(execFile);

/** Git actions that mutate the repository or remote. */
const WRITE_ACTIONS = new Set(['commit', 'push', 'pull', 'checkout', 'add']);

export class GitTool implements Tool {
  name = 'git';
  description = 'Git operations: status, log, diff, commit, branch, etc.';

  inputSchema = {
    type: 'object' as const,
    properties: {
      action: { type: 'string', description: 'Git action: status, log, diff, commit, branch, checkout, pull, push, add' },
      args: { type: 'string', description: 'Additional arguments' },
      message: { type: 'string', description: 'Commit message' },
      cwd: { type: 'string', description: 'Working directory' }
    },
    required: ['action']
  };

  metadata = {
    permissions: ['execute'] as ('read' | 'write' | 'execute' | 'network')[],
    tags: ['git', 'vcs'],
    version: '1.1.0'
  };

  parameters = [
    { name: 'action', type: 'string', description: 'Git action: status, log, diff, commit, branch, checkout, pull, push, add', required: true },
    { name: 'args', type: 'string', description: 'Additional arguments', required: false },
    { name: 'message', type: 'string', description: 'Commit message (for commit action)', required: false },
    { name: 'cwd', type: 'string', description: 'Working directory', required: false }
  ];

  /**
   * Run git with an argument array (no shell interpolation).
   */
  private async git(workDir: string, args: string[], timeoutMs = 60000): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync('git', args, {
      cwd: workDir,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
  }

  async execute(params: Record<string, any>, ctx?: ToolContext): Promise<ToolResult> {
    const { action, args, message, cwd } = params;
    const workDir = cwd || process.cwd();

    // existsSync(`${workDir}/.git`) worked by accident on Windows; do it properly.
    if (!existsSync(join(workDir, '.git'))) {
      return { success: false, error: 'Not a git repository' };
    }

    // v3.0.5: confirmation for mutating actions, decided by App (mode-aware).
    if (WRITE_ACTIONS.has(action)) {
      if (ctx?.confirmAction) {
        const summary = action === 'commit' && message
          ? `git commit -m "${String(message).slice(0, 80)}"`
          : `git ${action}${args ? ' ' + args : ''}`;
        const ok = await ctx.confirmAction(`执行 git 写操作: ${summary}`);
        if (!ok) {
          return { success: false, error: 'Git operation cancelled by user' };
        }
      } else {
        return { success: false, error: 'Git write operations require confirmation, but no confirmation channel is available (headless? add --yolo)' };
      }
    }

    try {
      switch (action) {
        case 'status':
          return await this.status(workDir);
        case 'log':
          return await this.log(workDir, args || '10');
        case 'diff':
          return await this.diff(workDir, args || '');
        case 'commit':
          return await this.commit(workDir, message || args);
        case 'branch':
          return await this.branch(workDir);
        case 'checkout':
          return await this.checkout(workDir, args);
        case 'pull':
          return await this.pull(workDir);
        case 'push':
          return await this.push(workDir);
        case 'add':
          return await this.add(workDir, args || '.');
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async status(cwd: string): Promise<ToolResult> {
    const { stdout } = await this.git(cwd, ['status', '--short']);
    return { success: true, output: stdout || '(clean)' };
  }

  private async log(cwd: string, limit: string): Promise<ToolResult> {
    // Numeric-only guard: `limit` used to be interpolated straight into the
    // command line. Parse it instead of trusting it.
    const n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const { stdout } = await this.git(cwd, ['log', '--oneline', '-n', String(n)]);
    return { success: true, output: stdout || 'No commits yet' };
  }

  private async diff(cwd: string, args: string): Promise<ToolResult> {
    const extra = args ? args.split(/\s+/).filter(Boolean) : [];
    const { stdout } = await this.git(cwd, ['diff', ...extra]);
    return { success: true, output: stdout || 'No changes' };
  }

  private async commit(cwd: string, message: string): Promise<ToolResult> {
    if (!message) {
      return { success: false, error: 'Commit message required' };
    }

    // Stage all changes
    await this.git(cwd, ['add', '-A']);

    const { stdout } = await this.git(cwd, ['commit', '-m', message]);
    return { success: true, output: stdout || 'Committed successfully' };
  }

  private async branch(cwd: string): Promise<ToolResult> {
    const { stdout } = await this.git(cwd, ['branch', '-a']);
    return { success: true, output: stdout };
  }

  private async checkout(cwd: string, branch: string): Promise<ToolResult> {
    if (!branch) {
      return { success: false, error: 'Branch name required' };
    }

    const { stdout } = await this.git(cwd, ['checkout', ...branch.split(/\s+/).filter(Boolean)]);
    return { success: true, output: stdout };
  }

  private async pull(cwd: string): Promise<ToolResult> {
    const { stdout } = await this.git(cwd, ['pull']);
    return { success: true, output: stdout };
  }

  private async push(cwd: string): Promise<ToolResult> {
    const { stdout } = await this.git(cwd, ['push']);
    return { success: true, output: stdout };
  }

  private async add(cwd: string, files: string): Promise<ToolResult> {
    const { stdout } = await this.git(cwd, ['add', ...files.split(/\s+/).filter(Boolean)]);
    return { success: true, output: stdout || 'Added successfully' };
  }
}

/**
 * Shell Tool - Execute shell commands with security checks
 * Migrated from old src/tools/shell.ts (permission logic inlined)
 */

import type { Tool, ToolResult, ToolContext } from './types.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Dangerous command patterns - blocked immediately, regardless of mode
const DANGEROUS_PATTERNS = [
  /^rm\s+-rf\s+\//i,
  /^del\s+\/f\s+\/s\s+\/q/i,
  /^format\s+[a-z]:/i,
  /^mkfs/i,
  /^dd\s+if=/i,
  /^shred/i,
  /^cat\s+\/dev\/null\s*>/i,
  />\s*\/dev\/sda/i,
  /^rm\s+-rf\s+\$HOME/i,
  /^rm\s+-rf\s+%USERPROFILE%/i,
  /^curl\s+.*\|.*sh/i,
  /^wget\s+.*\|.*sh/i,
  /^eval\s+/i,
  /base64\s+-d\s+.*\|/i,
];

/**
 * v3.0.20 (Codex-style approval grading): read-only commands run WITHOUT a
 * confirmation round-trip — the model used to ask permission for `git status`
 * and `ls`, which made simple inspection tasks feel like wading through
 * treacle. Only when every segment of the command (split on chaining
 * operators, same rule as isDangerous) is provably read-only do we skip the
 * ask; anything that writes, redirects, or executes scripts still goes
 * through ctx.confirmAction exactly as before.
 */
const READONLY_COMMANDS = new Set([
  // cross-platform inspection
  'ls', 'dir', 'pwd', 'cat', 'type', 'head', 'tail', 'wc', 'file', 'stat',
  'du', 'df', 'tree', 'find', 'grep', 'rg', 'which', 'where', 'whoami',
  'hostname', 'date', 'echo', 'env', 'printenv', 'node', 'python', 'python3',
  'git', 'npm', 'pip',
]);
/** For git: only these subcommands are read-only. */
const READONLY_GIT_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'show', 'branch', 'remote', 'tag', 'rev-parse',
  'describe', 'ls-files', 'blame', 'shortlog', 'config', 'ls-remote', 'cat-file',
]);

/** True when the command (whole string) is classified as read-only. */
export function isReadOnlyCommand(command: string): boolean {
  const segments = command.split(/(?:\s*(?:&&|\|\||;|\|)\s*|\r?\n)/).map(s => s.trim()).filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every(segment => {
    // Any redirection touches the filesystem — not read-only.
    if (/[<>]/.test(segment)) return false;
    const tokens = segment.split(/\s+/);
    const cmd = tokens[0].toLowerCase().replace(/\.exe$|\.cmd$|\.bat$/i, '');
    if (!READONLY_COMMANDS.has(cmd)) return false;
    // Version/help probes are always safe for interpreters and package managers.
    const args = tokens.slice(1).map(a => a.toLowerCase());
    if (cmd === 'node' || cmd === 'python' || cmd === 'python3') {
      return args.some(a => /^(-v|--version)$/.test(a)) || args.some(a => a === '--help' || a === '-h');
    }
    if (cmd === 'npm') {
      const sub = args[0];
      return ['ls', 'list', 'view', 'search', 'outdated', 'root', 'prefix', 'config'].includes(sub)
        && (sub !== 'config' || args[1] === 'get');
    }
    if (cmd === 'pip') {
      return ['list', 'show', 'freeze', '--version'].some(a => args.includes(a));
    }
    if (cmd === 'git') {
      const sub = (args[0] || '').toLowerCase();
      if (!READONLY_GIT_SUBCOMMANDS.has(sub)) return false;
      // `git config` writes without --get/--list; `git branch <name>` creates.
      if (sub === 'config') return args.some(a => a === '--get' || a === '--list' || a.startsWith('--get'));
      if (sub === 'branch') return args.length === 0 || args.every(a => a.startsWith('-'));
      return true;
    }
    return true;
  });
}

/** v3.0.20: cap tool output so a chatty command cannot flood the context. */
const MAX_OUTPUT_CHARS = 8000;
function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const head = output.slice(0, 4000);
  const tail = output.slice(-3000);
  return `${head}\n...[输出截断，省略 ${output.length - 7000} 字符]...\n${tail}`;
}

export class ShellTool implements Tool {
  name = 'shell';
  description = 'Execute shell commands and scripts. Read-only commands (git status/log/diff, ls, cat, …) run directly; anything that writes, redirects, or executes requires user confirmation.';

  inputSchema = {
    type: 'object' as const,
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Working directory' },
      timeout: { type: 'number', description: 'Timeout in seconds', default: 30 },
    },
    required: ['command'],
  };

  metadata = {
    permissions: ['execute', 'write', 'network'] as ('read' | 'write' | 'execute' | 'network')[],
    tags: ['shell', 'system', 'dangerous'],
    maxDuration: 120000,
    version: '1.0.0',
  };

  parameters = [
    { name: 'command', type: 'string', description: 'Shell command to execute', required: true },
    { name: 'cwd', type: 'string', description: 'Working directory', required: false },
    { name: 'timeout', type: 'number', description: 'Timeout in seconds', required: false },
  ];

  /**
   * Check if command matches dangerous patterns.
   * v3.0.19: split the command into segments on shell chaining operators
   * (&&, ||, ;, |) and newlines, then check every trimmed segment — a bare
   * whole-string match let `echo ok && rm -rf /` slip through because the
   * pattern is anchored to the start of the full string.
   *
   * Known limitation (naive, quote-unaware split): `echo "a && b"` is split
   * into `echo "a` / `b"` — harmless for the current pattern list (no false
   * block), but a quoted string containing an anchored-dangerous segment,
   * e.g. `echo "x && rm -rf /"`, WOULD be over-blocked.
   */
  private isDangerous(command: string): boolean {
    const segments = command.split(/(?:\s*(?:&&|\|\||;|\|)\s*|\r?\n)/);
    return segments.some(segment => DANGEROUS_PATTERNS.some(pattern => pattern.test(segment.trim())));
  }

  async execute(params: Record<string, any>, ctx?: ToolContext): Promise<ToolResult> {
    const { command, cwd, timeout = 30 } = params;

    if (!command || typeof command !== 'string') {
      return { success: false, error: 'Command is required and must be a string' };
    }

    const trimmed = command.trim();

    // Block dangerous commands
    if (this.isDangerous(trimmed)) {
      return { success: false, error: `Blocked: dangerous command "${trimmed.substring(0, 50)}..."` };
    }

    if (trimmed.length > 10000) {
      return { success: false, error: 'Command too long (max 10000 characters)' };
    }

    // v3.0.20: graded approval (Codex parity). Read-only commands (git
    // status, ls, cat, …) run directly; everything else still requires a
    // confirmation via App.requestConfirmation — 'accept' (--yolo) auto-
    // allows, 'ask' shows the prompt, headless denies. No channel → fail
    // closed for anything that is not provably read-only.
    if (!isReadOnlyCommand(trimmed)) {
      if (ctx?.confirmAction) {
        const confirmed = await ctx.confirmAction(`执行命令:\n  ${trimmed}`);
        if (!confirmed) {
          return { success: false, error: 'Command cancelled by user' };
        }
      } else {
        return { success: false, error: 'Shell execution requires confirmation, but no confirmation channel is available (headless? add --yolo)' };
      }
    }

    try {
      const options: any = {
        timeout: timeout * 1000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      };
      if (cwd) options.cwd = cwd;

      const { stdout, stderr } = await execAsync(command, options);
      const stdoutStr = stdout?.toString() || '';
      const stderrStr = stderr?.toString() || '';
      const output = stdoutStr + (stderrStr ? `\n[stderr]: ${stderrStr}` : '');

      return { success: true, output: truncateOutput(output.trim()) || '(command executed successfully with no output)' };
    } catch (error: any) {
      if (error.killed) {
        return { success: false, error: 'Command timed out' };
      }
      // Non-zero exit: return the partial output alongside the error so the
      // model can see what happened before the failure (Codex reports
      // exit code + aggregated output the same way).
      const partial = [error.stdout?.toString(), error.stderr?.toString()]
        .filter(Boolean).join('\n[stderr]: ');
      const detail = truncateOutput(partial.trim());
      return {
        success: false,
        error: detail ? `${error.message}\n${detail}` : (error.message || 'Command execution failed'),
      };
    }
  }
}

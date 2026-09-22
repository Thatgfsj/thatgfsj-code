/**
 * Shell Tool - Execute shell commands with security checks
 * Migrated from old src/tools/shell.ts (permission logic inlined)
 */

import type { Tool, ToolResult, ToolContext } from './types.js';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * v3.5.0 (field report): on a Chinese Windows install the child process
 * speaks the ANSI code page (GBK/936), but promisify(exec) decodes bytes
 * as UTF-8 — every non-ASCII char turned into U+FFFD garbage, polluting
 * both the model context and the TUI/--json output. Decode from the raw
 * bytes instead: strict UTF-8 first (git, node, chcp 65001 consoles),
 * then the console's code page, then latin1 as the lossless last resort.
 */
const CODEPAGE_DECODERS: Record<number, string> = {
  936: 'gbk', 950: 'big5', 932: 'shift_jis', 949: 'euc-kr',
  1250: 'windows-1250', 1251: 'windows-1251', 1252: 'windows-1252',
  65001: 'utf-8', 850: 'ibm850', 437: 'ibm437',
};

let cachedDecoderLabel: string | null = null;

function consoleDecoderLabel(): string {
  if (cachedDecoderLabel) return cachedDecoderLabel;
  cachedDecoderLabel = 'windows-1252'; // reasonable fallback
  if (process.platform === 'win32') {
    try {
      const out = execSync('chcp', { encoding: 'utf8', windowsHide: true, timeout: 3000 });
      const m = out.match(/(\d+)/);
      if (m) cachedDecoderLabel = CODEPAGE_DECODERS[Number(m[1])] || 'windows-1252';
    } catch {
      // keep fallback
    }
  } else {
    cachedDecoderLabel = 'utf-8';
  }
  return cachedDecoderLabel;
}

/**
 * v3.5.1: decode order matters. GBK Chinese text is USUALLY valid UTF-8
 * (GBK lead 0x81-0xFE + trail 0x40-0xFE overlap the UTF-8 lead/continuation
 * ranges), so strict-UTF-8-first "succeeded" with mojibake on a 936
 * console. Decode with the CONSOLE code page first; only fall back to
 * UTF-8 when that produced replacement characters (the child was a
 * UTF-8-native tool like node running on a 936 console).
 */
export function decodeConsoleOutput(buf: Buffer): string {
  if (buf.length === 0) return '';
  const isWin = process.platform === 'win32';
  const label = consoleDecoderLabel();
  if (isWin && label !== 'utf-8') {
    const byCodePage = safeDecode(buf, label);
    if (!/[\uFFFD]/.test(byCodePage)) return byCodePage;
    // Code page hit unmappable bytes — the child probably emitted UTF-8.
    const asUtf8 = safeDecode(buf, 'utf-8');
    if (!/[\uFFFD]/.test(asUtf8)) return asUtf8;
    return byCodePage;
  }
  if (isWin) {
    return safeDecode(buf, 'utf-8');
  }
  return safeDecode(buf, 'utf-8');
}

function safeDecode(buf: Buffer, label: string): string {
  try {
    return new TextDecoder(label, { fatal: false }).decode(buf);
  } catch {
    return buf.toString('latin1');
  }
}

// Dangerous command patterns - blocked immediately, regardless of mode.
// v3.5.4 (field report): the list was Unix-only — on Windows --yolo,
// `shutdown /s` was actually EXECUTED. Windows power/data destructive
// forms are now covered too.
const DANGEROUS_PATTERNS = [
  /^rm\s+-rf\s+\//i,
  /^del\s+\/f\s+\/s\s+\/q/i,
  /^rd\s+\/s(\s|$|\/)/i,
  /^rmdir\s+\/s(\s|$|\/)/i,
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
  /^shutdown(\.exe)?(\s|$|\/)/i,
  /^taskkill(\.exe)?\s+\/f/i,
  /^reg(\.exe)?\s+(add|delete|import|restore|unload)/i,
  /^cipher\s+\/w/i,
  /^wevtutil\s+cl/i,
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

/**
 * v3.4.0 (mcode-parity hardening): quote-aware segment split. The old naive
 * split on /&&|\|\||;|\|/ broke `echo "a && b"` into two bogus segments.
 */
export function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '&' && command[i + 1] === '&') { segments.push(current); current = ''; i++; continue; }
    if (ch === '|' && command[i + 1] === '|') { segments.push(current); current = ''; i++; continue; }
    if (ch === ';' || ch === '|' || ch === '\n' || ch === '\r') { segments.push(current); current = ''; continue; }
    current += ch;
  }
  segments.push(current);
  return segments.map(s => s.trim()).filter(Boolean);
}

/**
 * v3.4.0: commands that re-exec something else. A wrapper prefix must strip
 * its read-only shortcut (never auto-approve through it) and the INNER
 * command is what dangerous patterns must see.
 */
const WRAPPER_COMMANDS = new Set(['env', 'sudo', 'nohup', 'xargs', 'timeout', 'command', 'nice', 'setsid']);

/** Strip leading wrapper tokens (`env rm -rf /` → `rm -rf /`). */
function unwrapWrappers(tokens: string[]): string[] {
  let t = tokens;
  while (t.length > 0 && WRAPPER_COMMANDS.has(t[0].toLowerCase())) {
    // skip the wrapper plus option-ish tokens until the inner command word
    t = t.slice(1);
    while (t.length > 0 && (t[0].startsWith('-') || /^[A-Za-z_]\w*=/.test(t[0]) || /^\d+$/.test(t[0]))) t = t.slice(1);
  }
  return t;
}

/**
 * v3.4.0 (mcode bash-fast-allow idea): `TARGET=/etc/shadow type $TARGET` —
 * when leading assignments exist and later tokens reference them, the
 * "read-only" surface is a disguise. Conservative bail.
 */
function hasAssignmentDeception(tokens: string[]): boolean {
  const assigned: string[] = [];
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_]\w*=/.test(tokens[i])) {
    assigned.push(tokens[i].slice(0, tokens[i].indexOf('=')));
    i++;
  }
  if (assigned.length === 0 || i >= tokens.length) return false;
  const rest = tokens.slice(i).join(' ');
  return assigned.some(name => rest.includes('$' + name) || rest.toLowerCase().includes('%' + name.toLowerCase() + '%'));
}

/**
 * True when the command (whole string) is classified as read-only.
 * v3.4.0: quote-aware segments; wrapper prefixes never auto-approve;
 * assignment-deception bails; `find` write-capable flags are not read-only.
 */
export function isReadOnlyCommand(command: string): boolean {
  const segments = splitShellSegments(command);
  if (segments.length === 0) return false;
  return segments.every(segment => {
    // Any redirection touches the filesystem — not read-only.
    if (/[<>]/.test(segment)) return false;
    const rawTokens = segment.split(/\s+/);
    // Wrapper prefixes (env/sudo/xargs/…) disqualify the fast-allow path.
    if (WRAPPER_COMMANDS.has(rawTokens[0].toLowerCase())) return false;
    if (hasAssignmentDeception(rawTokens)) return false;
    const cmd = rawTokens[0].toLowerCase().replace(/\.exe$|\.cmd$|\.bat$/i, '');
    if (!READONLY_COMMANDS.has(cmd)) return false;
    // Version/help probes are always safe for interpreters and package managers.
    const args = rawTokens.slice(1).map(a => a.toLowerCase());
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
    if (cmd === 'find') {
      // v3.4.0: `find . -delete` / `-exec …` are write/execute, not inspection.
      return !args.some(a => ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fls'].includes(a));
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
    version: '1.0.0',
  };

  parameters = [
    { name: 'command', type: 'string', description: 'Shell command to execute', required: true },
    { name: 'cwd', type: 'string', description: 'Working directory', required: false },
    { name: 'timeout', type: 'number', description: 'Timeout in seconds', required: false },
  ];

  /**
   * Check if command matches dangerous patterns.
   * v3.0.19: check every segment on chaining operators, not the raw string.
   * v3.4.0: quote-aware split (`echo "x && rm -rf /"` no longer over-blocks
   * — but also, wrapper-stripped segments are checked so `env rm -rf /`
   * cannot hide behind the env prefix).
   */
  private isDangerous(command: string): boolean {
    const segments = splitShellSegments(command);
    return segments.some(segment => {
      const plain = DANGEROUS_PATTERNS.some(pattern => pattern.test(segment));
      if (plain) return true;
      const unwrapped = unwrapWrappers(segment.split(/\s+/)).join(' ');
      return unwrapped !== segment && DANGEROUS_PATTERNS.some(pattern => pattern.test(unwrapped));
    });
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
        encoding: 'buffer', // v3.5.0: decode ourselves (code-page aware)
      };
      if (cwd) options.cwd = cwd;

      const { stdout, stderr } = await execAsync(command, options);
      const stdoutStr = decodeConsoleOutput(stdout || Buffer.alloc(0));
      const stderrStr = decodeConsoleOutput(stderr || Buffer.alloc(0));
      const output = stdoutStr + (stderrStr ? `\n[stderr]: ${stderrStr}` : '');

      return { success: true, output: truncateOutput(output.trim()) || '(command executed successfully with no output)' };
    } catch (error: any) {
      if (error.killed) {
        return { success: false, error: 'Command timed out' };
      }
      // Non-zero exit: report exit code + OUR decoded output. Node's own
      // error.message embeds the stderr re-decoded as UTF-8 (mojibake on
      // GBK consoles), so it is deliberately NOT used here.
      const partial = [
        error.stdout ? decodeConsoleOutput(error.stdout) : '',
        error.stderr ? decodeConsoleOutput(error.stderr) : '',
      ].filter(Boolean).join('\n[stderr]: ');
      const detail = truncateOutput(partial.trim());
      const header = error.code != null
        ? `Command failed (exit ${error.code}): ${trimmed}`
        : `Command failed: ${trimmed}`;
      return {
        success: false,
        error: detail ? `${header}\n${detail}` : header,
      };
    }
  }
}

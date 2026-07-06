/**
 * Shell Tool - Execute shell commands with security checks
 * Migrated from old src/tools/shell.ts (permission logic inlined)
 */

import type { Tool, ToolResult, ToolContext } from './types.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Dangerous command patterns - blocked immediately
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

// Commands that need user confirmation
const CONFIRM_REQUIRED = [
  'rm -rf',
  'rmdir',
  'del /s /q',
  'format',
  'mkfs',
  'dd',
  'shutdown',
  'reboot',
  'pkill',
  'killall',
  'git push --force',
  'git push -f',
];

export class ShellTool implements Tool {
  name = 'shell';
  description = 'Execute shell commands and scripts. Some commands require user confirmation.';

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
   * Check if command matches dangerous patterns
   */
  private isDangerous(command: string): boolean {
    return DANGEROUS_PATTERNS.some(pattern => pattern.test(command.trim()));
  }

  /**
   * Check if command needs user confirmation
   */
  private needsConfirmation(command: string): boolean {
    const lower = command.toLowerCase();
    return CONFIRM_REQUIRED.some(cmd => lower.includes(cmd.toLowerCase()));
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

    // Ask for confirmation on risky commands
    if (ctx?.confirmAction && this.needsConfirmation(trimmed)) {
      const confirmed = await ctx.confirmAction(
        `⚠️  Confirm command:\n  ${command}\n\n[y] Yes  [n] No`
      );
      if (!confirmed) {
        return { success: false, error: 'Command cancelled by user' };
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

      return { success: true, output: output.trim() || '(command executed successfully with no output)' };
    } catch (error: any) {
      if (error.killed) {
        return { success: false, error: 'Command timed out' };
      }
      return { success: false, error: error.message || 'Command execution failed' };
    }
  }
}

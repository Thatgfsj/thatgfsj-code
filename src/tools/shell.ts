/**
 * Shell Tool - Execute shell commands with security checks
 */

import { Tool, ToolResult, ToolContext } from '../core/types.js';
import { PermissionChecker } from '../core/permissions.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

// Shared permission checker instance
let permissionChecker: PermissionChecker | null = null;

export function setPermissionChecker(checker: PermissionChecker) {
  permissionChecker = checker;
}

const execAsync = promisify(exec);

// Dangerous command patterns
const DANGEROUS_PATTERNS = [
  /^rm\s+-rf\s+\//i,           // rm -rf /
  /^del\s+\/f\s+\/s\s+\/q/i,   // del /f /s /q
  /^format\s+[a-z]:/i,         // format c:
  /^mkfs/i,                     // mkfs
  /^dd\s+if=/i,                 // dd if=
  /^shred/i,                    // shred
  /^cat\s+\/dev\/null\s*>/i,   // cat /dev/null >
  />\s*\/dev\/sda/i,           // Write to disk
  /^rm\s+-rf\s+\$HOME/i,       // rm -rf $HOME
  /^rm\s+-rf\s+%USERPROFILE%/i // Windows user profile
];

// Commands that need confirmation
const CONFIRM_REQUIRED = [
  'rm -rf',
  'rmdir',
  'del /s /q',
  'format',
  'mkfs',
  'dd',
  'shutdown',
  'restart',
  'init 0',
  'init 6',
  'poweroff',
  'reboot'
];

export class ShellTool implements Tool {
  name = 'shell';
  description = 'Execute shell commands and scripts. Use with caution - some commands require user confirmation.';

  /** S02: Input schema for shell command */
  inputSchema = {
    type: 'object' as const,
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Working directory' },
      timeout: { type: 'number', description: 'Timeout in seconds', default: 30 }
    },
    required: ['command']
  };

  /** S02: Tool metadata — permission and category info */
  metadata = {
    permissions: ['execute', 'write', 'network'] as ('read' | 'write' | 'execute' | 'network')[],
    tags: ['shell', 'system', 'dangerous'],
    maxDuration: 120000, // 2 min max
    version: '1.0.0'
  };

  parameters = [
    { name: 'command', type: 'string', description: 'Shell command to execute', required: true },
    { name: 'cwd', type: 'string', description: 'Working directory', required: false },
    { name: 'timeout', type: 'number', description: 'Timeout in seconds', required: false }
  ];

  /**
   * Check if command is dangerous
   */
  private isDangerous(command: string): boolean {
    return DANGEROUS_PATTERNS.some(pattern => pattern.test(command.trim()));
  }

  /**
   * Check if command needs confirmation
   */
  private needsConfirmation(command: string): boolean {
    const lower = command.toLowerCase();
    return CONFIRM_REQUIRED.some(cmd => lower.includes(cmd.toLowerCase()));
  }

  /**
   * Validate command before execution
   */
  private validateCommand(command: string): string | null {
    if (!command || typeof command !== 'string') {
      return 'Command is required and must be a string';
    }

    const trimmed = command.trim();
    
    // Check for dangerous commands
    if (this.isDangerous(trimmed)) {
      return `Dangerous command blocked: ${trimmed.substring(0, 50)}...`;
    }

    // Check command length
    if (trimmed.length > 10000) {
      return 'Command too long (max 10000 characters)';
    }

    return null;
  }

  async execute(params: Record<string, any>, ctx?: ToolContext): Promise<ToolResult> {
    const { command, cwd, timeout = 30 } = params;

    // Validate command
    const validationError = this.validateCommand(command);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // S03: 6-stage permission check
    if (permissionChecker) {
      const result = await permissionChecker.check('shell', params, ctx || {});
      if (!result.allowed) {
        return { success: false, error: `Permission denied: ${result.reason}` };
      }
      if (result.requiresConfirmation) {
        // Ask user for confirmation
        if (ctx?.confirmAction) {
          const confirmed = await ctx.confirmAction(
            `⚠️  Confirm command:\n  ${command}\n\n[y] Yes  [n] No`
          );
          if (!confirmed) {
            return { success: false, error: 'Command cancelled by user' };
          }
        }
      }
    } else if (ctx?.confirmAction && this.needsConfirmation(command)) {
      // Fallback confirmation
      const confirmed = await ctx.confirmAction(`Execute this command?\n  ${command}\n\nType 'y' to confirm or 'n' to cancel:`);
      if (!confirmed) {
        return { success: false, error: 'Command cancelled by user' };
      }
    }

    try {
      const options: any = { 
        timeout: timeout * 1000,
        maxBuffer: 10 * 1024 * 1024 // 10MB
      };
      
      if (cwd) {
        options.cwd = cwd;
      }

      const { stdout, stderr } = await execAsync(command, options);
      const stdoutStr = stdout?.toString() || '';
      const stderrStr = stderr?.toString() || '';
      
      // Combine output, prioritize stdout
      const output = stdoutStr + (stderrStr ? `\n[stderr]: ${stderrStr}` : '');
      
      return { success: true, output: output.trim() || '(command executed successfully with no output)' };
      
    } catch (error: any) {
      // Handle timeout
      if (error.killed) {
        return { success: false, error: 'Command timed out' };
      }
      
      return { 
        success: false, 
        error: error.message || 'Command execution failed' 
      };
    }
  }
}

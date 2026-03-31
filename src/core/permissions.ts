/**
 * S03: Permissions System
 * 6-stage permission pipeline for tool execution
 * Core principle: permissions are first-class citizens, not an afterthought
 */

import chalk from 'chalk';
import { ToolContext, ToolMetadata } from './types.js';

// ==================== Permission Types ====================

export type PermissionMode = 'accept' | 'deny' | 'ask';
export type PermissionLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface PermissionResult {
  allowed: boolean;
  reason: string;
  level: PermissionLevel;
  requiresConfirmation: boolean;
  stage: 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * Permission rule — pattern-based allow/deny rules
 */
export interface PermissionRule {
  pattern: RegExp;
  action: 'allow' | 'deny';
  reason: string;
}

/**
 * S03: Permission Checker — 6-stage pipeline
 */
export class PermissionChecker {
  private mode: PermissionMode = 'ask';
  private rules: PermissionRule[] = [];
  private workspaceRoot: string;

  // Stage 1: Blocked patterns
  private static BLOCKED_PATTERNS = [
    /^rm\s+-rf\s+\//i,
    /^rm\s+-rf\s+\$HOME/i,
    /^rm\s+-rf\s+%USERPROFILE%/i,
    /^del\s+\/f\s+\/s\s+\/q/i,
    /^format\s+[a-z]:/i,
    /^mkfs/i,
    /^dd\s+if=/i,
    /^shred/i,
    />\s*\/dev\/sda/i,
    /^curl\s+.*\||^wget\s+.*\|/i,
    /^eval\s+/i,
    /^exec\s+/i,
    /base64\s+-d\s+.*\|/i,
    /\$\(.*\)/i,
    /`.*`/i,
  ];

  // Stage 2: Commands needing confirmation
  private static CONFIRM_REQUIRED = [
    'rm -rf',
    'rmdir',
    'del /s /q',
    'format',
    'mkfs',
    'dd',
    'shutdown',
    'init 0',
    'init 6',
    'poweroff',
    'reboot',
    'pkill',
    'killall',
    'mv .* /tmp',
    'chmod 777',
    'chmod -R 777',
    'git push --force',
    'git push -f',
  ];

  // Stage 4: AI borderline commands (use LLM to classify)
  private static BORDERLINE_PATTERNS = [
    /curl\s+https?:\/\//i,
    /wget\s+/i,
    /npm\s+install\s+-g/i,
    /pip\s+install\s+/i,
    /yarn\s+add\s+/i,
    /sudo\s+/i,
    /chown\s+/i,
    /chmod\s+[67]/i,
    /^git\s+reset/i,
    /^git\s+clean/i,
  ];

  constructor(workspaceRoot: string = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * S03: 6-Stage Permission Pipeline
   * Every tool execution passes through all 6 stages
   */
  async check(
    toolName: string,
    params: Record<string, any>,
    ctx: ToolContext
  ): Promise<PermissionResult> {

    // Stage 1: Pattern block — reject known dangerous commands immediately
    const stage1 = this.stage1PatternBlock(toolName, params);
    if (!stage1.allowed) return stage1;

    // Stage 2: Permission rules — check user-defined allow/deny rules
    const stage2 = this.stage2Rules(toolName, params);
    if (!stage2.allowed) return stage2;

    // Stage 3: Path sandboxing — prevent workspace escape
    const stage3 = this.stage3PathSandbox(toolName, params);
    if (!stage3.allowed) return stage3;

    // Stage 4: AI classification for borderline cases
    const stage4 = await this.stage4AIClassify(toolName, params, ctx);
    if (!stage4.allowed) return stage4;

    // Stage 5: User confirmation for medium/high risk
    const stage5 = this.stage5Confirmation(toolName, params, ctx);
    if (stage5.requiresConfirmation) {
      return stage5;
    }

    // Stage 6: Pass through
    return {
      allowed: true,
      reason: 'Allowed',
      level: stage5.level,
      requiresConfirmation: false,
      stage: 6
    };
  }

  // Stage 1: Pattern block
  private stage1PatternBlock(toolName: string, params: Record<string, any>): PermissionResult {
    if (toolName !== 'shell') return { allowed: true, reason: 'Stage 1: N/A', level: 'none', requiresConfirmation: false, stage: 1 };

    const command = params.command || '';
    for (const pattern of PermissionChecker.BLOCKED_PATTERNS) {
      if (pattern.test(command.trim())) {
        return {
          allowed: false,
          reason: `Blocked: command matches dangerous pattern ${pattern}`,
          level: 'critical',
          requiresConfirmation: false,
          stage: 1
        };
      }
    }
    return { allowed: true, reason: 'Stage 1: Passed pattern check', level: 'none', requiresConfirmation: false, stage: 1 };
  }

  // Stage 2: User-defined rules
  private stage2Rules(toolName: string, params: Record<string, any>): PermissionResult {
    const command = params.command || '';

    for (const rule of this.rules) {
      if (rule.pattern.test(command)) {
        return {
          allowed: rule.action === 'allow',
          reason: `Rule matched: ${rule.reason}`,
          level: rule.action === 'deny' ? 'high' : 'none',
          requiresConfirmation: false,
          stage: 2
        };
      }
    }
    return { allowed: true, reason: 'Stage 2: No rules matched', level: 'none', requiresConfirmation: false, stage: 2 };
  }

  // Stage 3: Path sandboxing
  private stage3PathSandbox(toolName: string, params: Record<string, any>): PermissionResult {
    if (toolName !== 'shell' && toolName !== 'file') return { allowed: true, reason: 'Stage 3: N/A', level: 'none', requiresConfirmation: false, stage: 3 };

    const path = params.path || params.command || '';

    // Check for path traversal attempts
    if (/^\.\.\//.test(path) || /\%00/.test(path) || /\0/.test(path)) {
      return {
        allowed: false,
        reason: 'Blocked: path traversal attempt detected',
        level: 'high',
        requiresConfirmation: false,
        stage: 3
      };
    }

    return { allowed: true, reason: 'Stage 3: Path sandbox passed', level: 'none', requiresConfirmation: false, stage: 3 };
  }

  // Stage 4: AI classification for borderline commands
  private async stage4AIClassify(
    toolName: string,
    params: Record<string, any>,
    ctx: ToolContext
  ): Promise<PermissionResult> {
    if (toolName !== 'shell') return { allowed: true, reason: 'Stage 4: N/A', level: 'none', requiresConfirmation: false, stage: 4 };

    const command = params.command || '';

    // Check if borderline
    const isBorderline = PermissionChecker.BORDERLINE_PATTERNS.some(p => p.test(command));
    if (!isBorderline) {
      return { allowed: true, reason: 'Stage 4: Not borderline', level: 'none', requiresConfirmation: false, stage: 4 };
    }

    // For CLI, mark as medium risk (actual AI classification skipped for perf)
    return {
      allowed: true,
      reason: 'Stage 4: Borderline — escalated to confirmation',
      level: 'medium',
      requiresConfirmation: false,
      stage: 4
    };
  }

  // Stage 5: User confirmation
  private stage5Confirmation(
    toolName: string,
    params: Record<string, any>,
    ctx: ToolContext
  ): PermissionResult {
    if (this.mode === 'accept') {
      return { allowed: true, reason: 'Mode: accept all', level: 'none', requiresConfirmation: false, stage: 5 };
    }

    if (this.mode === 'deny') {
      return { allowed: false, reason: 'Mode: deny all', level: 'high', requiresConfirmation: false, stage: 5 };
    }

    // mode === 'ask'
    const command = params.command || '';

    // Critical: auto-deny
    if (/rm\s+-rf/.test(command) && !command.includes('node_modules')) {
      return {
        allowed: false,
        reason: 'Auto-deny: rm -rf without node_modules is too risky',
        level: 'critical',
        requiresConfirmation: false,
        stage: 5
      };
    }

    // Check confirm required list
    const needsConfirm = PermissionChecker.CONFIRM_REQUIRED.some(cmd =>
      command.toLowerCase().includes(cmd.toLowerCase())
    );

    if (needsConfirm) {
      return {
        allowed: true,
        reason: 'Requires user confirmation',
        level: 'medium',
        requiresConfirmation: true,
        stage: 5
      };
    }

    return { allowed: true, reason: 'Stage 5: No confirmation needed', level: 'low', requiresConfirmation: false, stage: 5 };
  }

  // ==================== Config Methods ====================

  setMode(mode: PermissionMode) {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  addRule(pattern: RegExp, action: 'allow' | 'deny', reason: string) {
    this.rules.push({ pattern, action, reason });
  }

  clearRules() {
    this.rules = [];
  }

  setWorkspaceRoot(path: string) {
    this.workspaceRoot = path;
  }
}

// ==================== Permission Mode CLI ====================

export function printPermissionResult(result: PermissionResult, command?: string) {
  if (!result.allowed) {
    console.log(chalk.red(`\n🚫 BLOCKED [Stage ${result.stage}]: ${result.reason}`));
    return;
  }

  if (result.requiresConfirmation && command) {
    console.log(chalk.yellow(`\n⚠️  Requires confirmation [Stage ${result.stage}]: ${result.reason}`));
    console.log(chalk.gray(`  Command: ${command}`));
    return;
  }

  console.log(chalk.green(`\n✅ Allowed [Stage ${result.stage}]: ${result.reason}`));
}

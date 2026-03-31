/**
 * S08: Hooks System
 * Inject custom logic at key event points without modifying agent source code
 * 
 * Hook points: before/after tool calls, before/after agent loop, onError, etc.
 * Users can register hooks for: audit logging, auto-formatting, security filtering, notifications
 */

import { ChatMessage, ToolCall } from './types.js';

// ==================== Hook Types ====================

export type HookName =
  | 'beforeToolCall'
  | 'afterToolCall'
  | 'beforeAgentLoop'
  | 'afterAgentLoop'
  | 'onError'
  | 'beforeMessage'
  | 'afterMessage'
  | 'onCompact';

export interface HookContext {
  toolName?: string;
  toolParams?: Record<string, any>;
  toolResult?: any;
  messages?: ChatMessage[];
  error?: Error;
  iteration?: number;
  [key: string]: any;
}

export type HookFn = (ctx: HookContext) => void | Promise<void>;

export interface HookRegistration {
  name: HookName;
  fn: HookFn;
  priority?: number; // Higher = runs first
  once?: boolean;    // If true, auto-remove after first run
}

// ==================== Hook Manager ====================

export class HookManager {
  private hooks: Map<HookName, HookRegistration[]> = new Map();

  constructor() {
    // Initialize all hook types
    const allHooks: HookName[] = [
      'beforeToolCall', 'afterToolCall', 'beforeAgentLoop', 'afterAgentLoop',
      'onError', 'beforeMessage', 'afterMessage', 'onCompact'
    ];
    for (const h of allHooks) {
      this.hooks.set(h, []);
    }
  }

  /**
   * S08: Register a hook
   * @param name Hook point name
   * @param fn Function to run
   * @param priority Higher priority runs first
   * @param once If true, auto-removed after first run
   */
  register(name: HookName, fn: HookFn, priority = 0, once = false): void {
    const regs = this.hooks.get(name) || [];
    regs.push({ name, fn, priority, once });
    regs.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    this.hooks.set(name, regs);
  }

  /**
   * S08: Unregister a hook by function reference
   */
  unregister(name: HookName, fn: HookFn): void {
    const regs = this.hooks.get(name) || [];
    this.hooks.set(name, regs.filter(r => r.fn !== fn));
  }

  /**
   * S08: Clear all hooks for a given name (or all)
   */
  clear(name?: HookName): void {
    if (name) {
      this.hooks.set(name, []);
    } else {
      for (const [, regs] of this.hooks) {
        regs.length = 0;
      }
    }
  }

  /**
   * S08: Emit a hook — call all registered functions at that point
   * Returns after all sync hooks complete, awaits async ones
   */
  async emit(name: HookName, ctx: HookContext): Promise<void> {
    const regs = this.hooks.get(name) || [];

    for (const reg of regs) {
      try {
        await Promise.resolve(reg.fn(ctx));
      } catch (error: any) {
        console.error(`[Hook ${name}] error:`, error.message);
      }

      // Remove if one-time hook
      if (reg.once) {
        this.unregister(name, reg.fn);
      }
    }
  }

  /**
   * S08: Check if any hooks are registered for a given name
   */
  hasHooks(name: HookName): boolean {
    return (this.hooks.get(name)?.length || 0) > 0;
  }

  /**
   * S08: Get hook count
   */
  getHookCount(name?: HookName): number {
    if (name) {
      return this.hooks.get(name)?.length || 0;
    }
    let total = 0;
    for (const regs of this.hooks.values()) {
      total += regs.length;
    }
    return total;
  }
}

// ==================== Built-in Hooks ====================

/**
 * S08: Audit logging hook — logs all tool calls
 */
export function auditLogHook(ctx: HookContext): void {
  if (ctx.toolName) {
    const ts = new Date().toISOString().split('T')[1].split('.')[0];
    const status = ctx.toolResult?.success ? 'OK' : 'FAIL';
    console.log(`[AUDIT ${ts}] ${status} | tool=${ctx.toolName} | params=${JSON.stringify(ctx.toolParams || {})} | result=${ctx.toolResult?.success ? 'OK' : ctx.toolResult?.error}`);
  }
}

/**
 * S08: Prettier auto-format hook — run prettier after file writes
 */
export async function prettierFormatHook(ctx: HookContext): Promise<void> {
  if (ctx.toolName === 'file' && ctx.toolParams?.action === 'write') {
    const path = ctx.toolParams.path;
    const ext = path.split('.').pop()?.toLowerCase();

    const formattable = ['js', 'ts', 'jsx', 'tsx', 'json', 'md', 'css', 'html'];
    if (formattable.includes(ext || '')) {
      console.log(`[Hook] Auto-format skipped (prettier not installed) for ${path}`);
      // In real impl: spawn prettier on the file
    }
  }
}

/**
 * S08: Security filter hook — block suspicious patterns
 */
export function securityFilterHook(ctx: HookContext): { blocked: boolean; reason: string } {
  if (ctx.toolName === 'shell' && ctx.toolParams?.command) {
    const cmd = ctx.toolParams.command;
    const suspicious = [
      /curl\s+.*\|.*sh/i,
      /wget\s+.*\|.*sh/i,
      /base64\s+-d/i,
      /\.\/[^/]+\s+&&.*rm/i
    ];

    for (const pattern of suspicious) {
      if (pattern.test(cmd)) {
        return { blocked: true, reason: `Suspicious pattern detected: ${pattern}` };
      }
    }
  }
  return { blocked: false, reason: '' };
}

// ==================== Singleton ====================

let globalHookManager: HookManager | null = null;

export function getHookManager(): HookManager {
  if (!globalHookManager) {
    globalHookManager = new HookManager();
  }
  return globalHookManager;
}

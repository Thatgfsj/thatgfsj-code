/**
 * Hooks System - Event-driven lifecycle hooks
 * Migrated from old src/core/hooks.ts
 */

import type { ChatMessage, ToolCall } from '../types.js';

// ==================== Hook Types ====================

export type HookName =
  | 'beforeToolCall'
  | 'afterToolCall'
  | 'beforeAgentLoop'
  | 'afterAgentLoop'
  | 'onError';

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

interface HookRegistration {
  name: HookName;
  fn: HookFn;
  priority?: number;
  once?: boolean;
}

// ==================== Hook Manager ====================

export class HookManager {
  private hooks: Map<HookName, HookRegistration[]> = new Map();

  constructor() {
    const allHooks: HookName[] = ['beforeToolCall', 'afterToolCall', 'beforeAgentLoop', 'afterAgentLoop', 'onError'];
    for (const h of allHooks) {
      this.hooks.set(h, []);
    }
  }

  register(name: HookName, fn: HookFn, priority = 0, once = false): void {
    const regs = this.hooks.get(name) || [];
    regs.push({ name, fn, priority, once });
    regs.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    this.hooks.set(name, regs);
  }

  unregister(name: HookName, fn: HookFn): void {
    const regs = this.hooks.get(name) || [];
    this.hooks.set(name, regs.filter(r => r.fn !== fn));
  }

  clear(name?: HookName): void {
    if (name) {
      this.hooks.set(name, []);
    } else {
      for (const regs of this.hooks.values()) {
        regs.length = 0;
      }
    }
  }

  async emit(name: HookName, ctx: HookContext): Promise<void> {
    const regs = this.hooks.get(name) || [];
    for (const reg of regs) {
      try {
        await Promise.resolve(reg.fn(ctx));
      } catch (error: any) {
        console.error(`[Hook ${name}] error:`, error.message);
      }
      if (reg.once) {
        this.unregister(name, reg.fn);
      }
    }
  }

  hasHooks(name: HookName): boolean {
    return (this.hooks.get(name)?.length || 0) > 0;
  }
}

// ==================== Built-in Hooks ====================

/**
 * Audit logging hook - logs all tool calls
 */
export function auditLogHook(ctx: HookContext): void {
  if (ctx.toolName) {
    const ts = new Date().toISOString().split('T')[1].split('.')[0];
    const status = ctx.toolResult?.success ? 'OK' : 'FAIL';
    console.log(`[AUDIT ${ts}] ${status} | tool=${ctx.toolName} | params=${JSON.stringify(ctx.toolParams || {})}`);
  }
}

// ==================== Singleton ====================

let globalHookManager: HookManager | null = null;

export function getHookManager(): HookManager {
  if (!globalHookManager) {
    globalHookManager = new HookManager();
  }
  return globalHookManager;
}

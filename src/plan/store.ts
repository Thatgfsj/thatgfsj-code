/**
 * Plan Store — shared state for the update_plan tool (Codex parity).
 *
 * The model calls `update_plan` to lay out multi-step tasks and keep their
 * statuses current. The store is a module-level singleton so the tool
 * (inside the agent loop), the TUI live panel and the /plan command all see
 * the same state without threading a reference through every layer.
 *
 * Snapshot reference stability matters: the TUI reads it through
 * useSyncExternalStore, which re-renders only when the snapshot reference
 * changes, so `set` always installs a fresh array and `getSnapshot` never
 * mutates in place.
 */

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanItem {
  step: string;
  status: PlanItemStatus;
}

export function isPlanItemStatus(v: unknown): v is PlanItemStatus {
  return v === 'pending' || v === 'in_progress' || v === 'completed';
}

type Listener = () => void;

class PlanStore {
  private items: PlanItem[] = [];
  private listeners = new Set<Listener>();

  /**
   * v3.2.0 CRITICAL: every method is an arrow-function field. PlanPanel hands
   * `planStore.getSnapshot` / `planStore.subscribe` to useSyncExternalStore as
   * BARE references — prototype methods would run with `this === undefined`
   * and throw "Cannot read properties of undefined (reading 'items')" the
   * moment the chat view (the only PlanPanel mount site) rendered. That was
   * the unreproducible-in-tests startup crash: tests only rendered splash.
   */
  getSnapshot = (): PlanItem[] => this.items;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private emit = (): void => {
    for (const fn of [...this.listeners]) {
      try { fn(); } catch { /* a broken subscriber must not break the tool */ }
    }
  };

  set = (items: PlanItem[]): void => {
    this.items = items.map(i => ({ step: i.step, status: i.status }));
    this.emit();
  };

  clear = (): void => {
    if (this.items.length === 0) return;
    this.items = [];
    this.emit();
  };

  /** Progress summary line, e.g. `2/5 完成 · 当前: 编写测试`. */
  progressText = (): string => {
    const done = this.items.filter(i => i.status === 'completed').length;
    const current = this.items.find(i => i.status === 'in_progress');
    const base = `${done}/${this.items.length} 完成`;
    return current ? `${base} · 当前: ${current.step}` : base;
  };
}

export const planStore = new PlanStore();

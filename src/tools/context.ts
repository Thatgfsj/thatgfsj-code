/**
 * Get Context Remaining Tool — Codex `get_context_remaining` parity.
 *
 * Lets the MODEL check how much of the context window is left, so a long
 * task can adapt before the 85% auto-compact fires: wrap up loose ends,
 * avoid re-reading huge files, or finish the step cleanly. Built via a
 * factory because the numbers live on the App singleton (sessionStats +
 * getContextWindow), which the static ToolRegistry cannot see.
 */

import type { Tool, ToolResult, ToolContext } from './types.js';

export interface ContextState {
  /** Prompt tokens of the last completed round (= current context size). */
  used: number;
  /** Model context window in tokens. */
  window: number;
}

export function createGetContextTool(getState: () => ContextState): Tool {
  return {
    name: 'get_context_remaining',
    description: [
      'Check how much of the model context window is still available.',
      'Call this during long multi-step tasks to decide whether to wrap up now,',
      'or keep working. Auto-compaction fires at 85% usage.',
    ].join(' '),
    parameters: [],
    inputSchema: { type: 'object' as const, properties: {} },
    metadata: {
      permissions: [],
      tags: ['context', 'meta'],
      version: '1.0.0',
    },
    async execute(_params: Record<string, any>, _ctx?: ToolContext): Promise<ToolResult> {
      let state: ContextState;
      try {
        state = getState();
      } catch (e: any) {
        return { success: false, error: `Context state unavailable: ${e.message}` };
      }
      const used = Math.max(0, state.used || 0);
      const win = Math.max(1, state.window || 128000);
      const pct = Math.min(100, Math.round((used / win) * 100));
      const remaining = Math.max(0, win - used);
      const advice =
        pct >= 85 ? 'Auto-compact will fire soon — wrap up and hand off cleanly.'
          : pct >= 60 ? 'Getting crowded — prefer targeted reads and smaller outputs.'
            : 'Plenty of room — continue normally.';
      return {
        success: true,
        output: `Context: ${used.toLocaleString()}/${win.toLocaleString()} tokens used (${pct}%). Remaining ≈ ${remaining.toLocaleString()}. ${advice}`,
        data: { used, window: win, remaining, percent: pct },
      };
    },
  };
}

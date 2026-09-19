/**
 * Update Plan Tool — Codex `update_plan` parity.
 *
 * For multi-step tasks the model declares a plan (ordered steps with
 * statuses) and keeps it current as work progresses. The TUI renders the
 * live plan panel from the shared planStore; an empty `plan` array clears
 * it. This tool is pure state — no confirmation needed.
 */

import type { Tool, ToolResult, ToolContext } from './types.js';
import { planStore, isPlanItemStatus, type PlanItem } from '../plan/store.js';

export class UpdatePlanTool implements Tool {
  name = 'update_plan';
  description = [
    'Set or update the task plan for the current request. Use this at the start of any multi-step task',
    '(3+ distinct actions) and keep statuses up to date after each step. Steps must be short imperatives.',
    'Exactly one step should be "in_progress" at a time. Pass an empty plan array to clear the plan',
    '(when the task is done or the request is single-step).',
  ].join(' ');

  inputSchema = {
    type: 'object' as const,
    properties: {
      plan: {
        type: 'array',
        description: 'Ordered plan steps. Empty array clears the plan.',
        items: {
          type: 'object',
          properties: {
            step: { type: 'string', description: 'Short imperative description of the step' },
            status: { type: 'string', description: 'Step status', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['step', 'status'],
        },
      },
      explanation: { type: 'string', description: 'One-line note about why the plan changed (optional)' },
    },
    required: ['plan'],
  };

  metadata = {
    permissions: [] as ('read' | 'write' | 'execute' | 'network')[],
    tags: ['planning'],
    version: '1.0.0',
  };

  parameters = [
    { name: 'plan', type: 'array', description: 'Ordered steps: [{step, status: pending|in_progress|completed}]. Empty array clears.', required: true },
    { name: 'explanation', type: 'string', description: 'Why the plan changed (optional)', required: false },
  ];

  async execute(params: Record<string, any>, _ctx?: ToolContext): Promise<ToolResult> {
    const raw = params?.plan;
    if (!Array.isArray(raw)) {
      return { success: false, error: '[PARAM_ERROR] "plan" must be an array of {step, status} items (empty array clears the plan).' };
    }

    if (raw.length === 0) {
      planStore.clear();
      return { success: true, output: 'Plan cleared.' };
    }

    const items: PlanItem[] = [];
    for (let i = 0; i < raw.length; i++) {
      const it = raw[i];
      const step = typeof it?.step === 'string' ? it.step.trim() : '';
      if (!step) {
        return { success: false, error: `[PARAM_ERROR] plan[${i}].step must be a non-empty string.` };
      }
      if (!isPlanItemStatus(it?.status)) {
        return { success: false, error: `[PARAM_ERROR] plan[${i}].status must be one of: pending, in_progress, completed (got ${JSON.stringify(it?.status)}).` };
      }
      items.push({ step, status: it.status });
    }

    planStore.set(items);

    const inProgress = items.filter(i => i.status === 'in_progress');
    let output = `Plan updated: ${planStore.progressText()}`;
    if (inProgress.length > 1) {
      output += ` (note: ${inProgress.length} steps are in_progress — keep only one)` ;
    } else if (inProgress.length === 0) {
      output += ' (note: no step is in_progress — mark the one you are working on)';
    }
    if (typeof params?.explanation === 'string' && params.explanation.trim()) {
      output += `\n${params.explanation.trim()}`;
    }
    return { success: true, output };
  }
}

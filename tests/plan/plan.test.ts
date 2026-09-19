import { describe, it, expect, beforeEach } from 'vitest';
import { UpdatePlanTool } from '../../src/tools/plan.js';
import { planStore, type PlanItem } from '../../src/plan/store.js';

const tool = new UpdatePlanTool();

const planOf = (snapshot: PlanItem[]) => snapshot.map(i => `${i.status}:${i.step}`);

beforeEach(() => {
  planStore.clear();
});

describe('UpdatePlanTool + PlanStore', () => {
  it('sets a plan and reports progress', async () => {
    const r = await tool.execute({
      plan: [
        { step: '调研', status: 'completed' },
        { step: '实现', status: 'in_progress' },
        { step: '测试', status: 'pending' },
      ],
    });
    expect(r.success).toBe(true);
    expect(planStore.getSnapshot().length).toBe(3);
    expect(r.output).toContain('1/3 完成');
    expect(r.output).toContain('实现');
  });

  it('keeps snapshot reference stable between changes (useSyncExternalStore contract)', async () => {
    const a = planStore.getSnapshot();
    await tool.execute({ plan: [{ step: 'x', status: 'pending' }] });
    const b = planStore.getSnapshot();
    expect(a).not.toBe(b);
    expect(planStore.getSnapshot()).toBe(b);
  });

  it('notifies subscribers exactly once per update; clear() is silent when empty', () => {
    let calls = 0;
    const unsub = planStore.subscribe(() => calls++);
    planStore.set([{ step: 'a', status: 'pending' }]);
    planStore.clear();
    expect(calls).toBe(2);
    planStore.clear(); // already empty → no emit
    expect(calls).toBe(2);
    unsub();
  });

  it('empty plan array clears the plan', async () => {
    await tool.execute({ plan: [{ step: 'a', status: 'pending' }] });
    const r = await tool.execute({ plan: [] });
    expect(r.success).toBe(true);
    expect(planStore.getSnapshot()).toEqual([]);
  });

  it('rejects invalid statuses and empty steps without touching state', async () => {
    await tool.execute({ plan: [{ step: 'keep', status: 'pending' }] });
    const before = planStore.getSnapshot();

    const bad1 = await tool.execute({ plan: [{ step: 'x', status: 'done' }] });
    expect(bad1.success).toBe(false);
    expect(bad1.error).toContain('pending, in_progress, completed');

    const bad2 = await tool.execute({ plan: [{ step: '  ', status: 'pending' }] });
    expect(bad2.success).toBe(false);

    const bad3 = await tool.execute({ plan: 'not an array' });
    expect(bad3.success).toBe(false);

    expect(planOf(planStore.getSnapshot())).toEqual(planOf(before));
  });

  it('warns when zero or multiple steps are in_progress', async () => {
    const none = await tool.execute({ plan: [{ step: 'a', status: 'completed' }] });
    expect(none.output).toContain('no step is in_progress');
    const many = await tool.execute({
      plan: [
        { step: 'a', status: 'in_progress' },
        { step: 'b', status: 'in_progress' },
      ],
    });
    expect(many.output).toContain('2 steps are in_progress');
  });

  it('/plan-facing progressText reflects store state', async () => {
    await tool.execute({
      plan: [
        { step: 'a', status: 'completed' },
        { step: 'b', status: 'in_progress' },
      ],
    });
    expect(planStore.progressText()).toContain('1/2 完成');
    expect(planStore.progressText()).toContain('b');
  });
});

// @vitest-environment node
/** @jsxImportSource react */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { PlanPanel } from '../../src/tui/components/PlanPanel.js';
import { planStore } from '../../src/plan/store.js';

/**
 * v3.2.0 crash regression. PlanPanel hands `planStore.subscribe` and
 * `planStore.getSnapshot` to useSyncExternalStore as BARE references; when
 * those were prototype methods they ran with `this === undefined` and threw
 * "Cannot read properties of undefined (reading 'items')" the moment the
 * chat view mounted the panel. The old tests only rendered the splash
 * branch, so this shipped broken. Both layers are covered here:
 * the bare-reference call and the real component mount.
 */

afterEach(() => { planStore.clear(); });

describe('PlanPanel mount (v3.2.0 items crash regression)', () => {
  it('bare planStore.getSnapshot()/subscribe() references work unbound', () => {
    const getSnapshot = planStore.getSnapshot;
    expect(getSnapshot()).toEqual([]);
    const subscribe = planStore.subscribe;
    const unsub = subscribe(() => {});
    unsub();
  });

  it('store methods still work when called normally', () => {
    planStore.set([{ step: 'first', status: 'completed' }, { step: 'second', status: 'in_progress' }]);
    expect(planStore.getSnapshot()).toHaveLength(2);
    expect(planStore.progressText()).toContain('1/2');
    planStore.clear();
    expect(planStore.getSnapshot()).toEqual([]);
  });

  it('renders through useSyncExternalStore with live items', () => {
    planStore.set([
      { step: '扫描目录', status: 'completed' },
      { step: '编写测试', status: 'in_progress' },
    ]);
    const { lastFrame } = render(<PlanPanel width={60} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('计划');
    expect(frame).toContain('1/2');
    expect(frame).toContain('扫描目录');
    expect(frame).toContain('编写测试');
  });
});

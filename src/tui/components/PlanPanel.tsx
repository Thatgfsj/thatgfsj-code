/** @jsxImportSource react */
import React, { useSyncExternalStore } from 'react';
import { Box, Text } from 'ink';
import { planStore } from '../../plan/store.js';
import { theme } from '../theme.js';

const MAX_VISIBLE = 7;

const MARKS = {
  completed: { glyph: '✓', color: theme.success },
  in_progress: { glyph: '●', color: theme.accent },
  pending: { glyph: '○', color: theme.textFaint },
} as const;

/**
 * Live plan panel (Codex `update_plan` parity). Sits between the chat
 * scrollback and the thinking spinner — the plan the model is working
 * through stays visible without polluting the Static history (tool result
 * lines already record each update there). Hidden entirely when no plan
 * is active so the live frame keeps its constant height.
 */
export function PlanPanel({ width }: { width: number }) {
  const items = useSyncExternalStore(planStore.subscribe, planStore.getSnapshot);
  if (items.length === 0) return null;

  const done = items.filter(i => i.status === 'completed').length;
  const visible = items.slice(0, MAX_VISIBLE);
  const hidden = items.length - visible.length;
  const rule = '─'.repeat(Math.max(12, width - 16));

  return (
    <Box flexDirection="column" width={width} paddingLeft={1}>
      <Text color={theme.textFaint}>
        <Text color={theme.accentDim}>◇ 计划 </Text>
        {done}/{items.length} {rule}
      </Text>
      {visible.map((it, i) => {
        const mark = MARKS[it.status];
        return (
          <Text key={i} color={it.status === 'pending' ? theme.textFaint : it.status === 'in_progress' ? theme.text : theme.textDim}>
            {'  '}
            <Text color={mark.color}>{mark.glyph}</Text>
            {' '}
            {it.status === 'in_progress' ? <Text color={theme.accent}>{it.step}</Text> : it.step}
          </Text>
        );
      })}
      {hidden > 0 && (
        <Text color={theme.textFaint}>  … 还有 {hidden} 项</Text>
      )}
    </Box>
  );
}

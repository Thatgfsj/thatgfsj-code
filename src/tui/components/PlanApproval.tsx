/** @jsxImportSource react */
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../theme.js';

interface Props {
  onAnswer: (decision: 'approve' | 'stay' | 'exit') => void;
}

/**
 * v3.1.0: blue plan-approval dialog (/计划模式). Shown after each turn while
 * plan mode is active — the model researched and drafted a plan, the user
 * decides what happens next:
 *   y / enter → approve the plan → switch to FULL PERMISSION (red) and the
 *               approved plan starts executing immediately
 *   n / esc   → stay in plan mode (keep researching / refining the plan)
 *   e         → leave plan mode back to the default confirm mode
 */
export function PlanApproval({ onAnswer }: Props) {
  const [answered, setAnswered] = useState(false);

  useInput((input, key) => {
    if (answered) return;
    if (input === 'y' || input === 'Y' || key.return) {
      setAnswered(true);
      onAnswer('approve');
      return;
    }
    if (input === 'n' || input === 'N' || key.escape) {
      setAnswered(true);
      onAnswer('stay');
      return;
    }
    if (input === 'e' || input === 'E') {
      setAnswered(true);
      onAnswer('exit');
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.info} paddingX={1} width="100%">
      <Text color={theme.info} bold>🔵 计划已就绪 — 是否批准？</Text>
      <Text color={theme.textDim}>批准后进入 <Text color={theme.error} bold>完整权限模式（红）</Text>，并立即开始按计划执行。</Text>
      <Box marginTop={0}>
        <Text color={theme.info} bold>[y] 批准并执行</Text>
        <Text color={theme.textFaint}> · </Text>
        <Text color={theme.textDim} bold>[n] 继续计划讨论</Text>
        <Text color={theme.textFaint}> · </Text>
        <Text color={theme.textFaint} bold>[e] 退出计划模式</Text>
      </Box>
    </Box>
  );
}

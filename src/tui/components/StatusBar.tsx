/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

interface Props {
  messageCount: number;
  skills: string[];
  /** Current provider/model id (v3.0.6 — moved here from Header). */
  provider?: string;
  model?: string;
}

/**
 * v3.0.13 (opencode-style footer): one status line, splash only.
 * left: provider/model · right: message count + active skills.
 * v3.4.0: the dead SessionStats contract (ctx chip / ↑↓ tokens / 节省 ¥)
 * is GONE — live numbers live in the right-hand 上下文容量 panel, and the
 * money line was explicitly removed in 3.2.1.
 */
export const StatusBar = React.memo(function StatusBar({ messageCount, skills, provider, model }: Props) {
  const activeSkills = skills.slice(0, 3).join(', ');
  const moreSkills = skills.length > 3 ? ` +${skills.length - 3}` : '';

  return (
    <Box flexDirection="column" marginTop={0}>
      <Box justifyContent="space-between" width="100%">
        <Box>
          {provider && model ? (
            <>
              <Text color={theme.textDim}>{provider}</Text>
              <Text color={theme.textFaint}>/</Text>
              <Text color={theme.textDim}>{model}</Text>
            </>
          ) : null}
        </Box>
        <Box>
          <Text color={theme.textFaint}>{messageCount} 条</Text>
          {skills.length > 0 && (
            <Text color={theme.textFaint}> · 技能 {activeSkills}{moreSkills}</Text>
          )}
          <Text color={theme.textFaint}> · /help</Text>
        </Box>
      </Box>
    </Box>
  );
});

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
 * v3.0.6 (opencode-style footer): thin rule + one status line.
 * left: provider/model · right: messages · active skills
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

/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  messageCount: number;
  skills: string[];
}

export const StatusBar = React.memo(function StatusBar({ messageCount, skills }: Props) {
  const activeSkills = skills.slice(0, 3).join(', ');
  const moreSkills = skills.length > 3 ? ` +${skills.length - 3}` : '';

  return (
    <Box flexDirection="column" marginTop={0}>
      <Text color="#374151">{'─'.repeat(80)}</Text>
      <Box justifyContent="space-between" width="100%">
        <Box>
          <Text backgroundColor="#06B6D4" color="#0F172A" bold> ⚡ THATGFSJ CODE </Text>
          <Text dimColor> │ {messageCount} 条消息</Text>
        </Box>
        <Box>
          {skills.length > 0 && (
            <Text dimColor> 技能: {activeSkills}{moreSkills} </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
});

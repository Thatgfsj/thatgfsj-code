/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  provider: string;
  model: string;
}

export const Header = React.memo(function Header({ provider, model }: Props) {
  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box justifyContent="space-between" width="100%">
        <Box>
          <Text color="#06B6D4" bold> ⚡ </Text>
          <Text color="#22D3EE" bold>THATGFSJ CODE</Text>
          <Text dimColor> v1.0.4</Text>
        </Box>
        <Box>
          <Text color="#06B6D4" bold> {provider} </Text>
          <Text dimColor>/</Text>
          <Text color="#22D3EE"> {model} </Text>
        </Box>
      </Box>
      <Text color="#374151">{'─'.repeat(80)}</Text>
    </Box>
  );
});

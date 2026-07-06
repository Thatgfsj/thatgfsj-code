/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  active?: boolean;
}

export function Thinking({ active = false }: Props) {
  if (!active) return null;

  return (
    <Box paddingLeft={1}>
      <Text color="#06B6D4">⟳ Thinking...</Text>
    </Box>
  );
}

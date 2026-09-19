/** @jsxImportSource react */
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface Props {
  active?: boolean;
}

/**
 * v3.0.6 (opencode-style): braille spinner + elapsed seconds. The interval
 * only runs while the component is mounted (active), and unmounts to a
 * plain null when the round finishes.
 */
export function Thinking({ active = false }: Props) {
  const [frame, setFrame] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    const spin = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), 80);
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => {
      clearInterval(spin);
      clearInterval(tick);
    };
  }, [active, startedAt]);

  if (!active) return null;

  return (
    <Box paddingLeft={2}>
      <Text color={theme.accent}>{FRAMES[frame]} </Text>
      <Text color={theme.textDim}>thinking{elapsed > 0 ? `… ${elapsed}s` : '…'}</Text>
    </Box>
  );
}

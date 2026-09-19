/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

/**
 * Block-letter logo, opencode-style two-tone: "gf" in dim gray,
 * "code" in bright white. 5 rows, 49 columns — fits an 80-col terminal.
 */
const LOGO_DIM = [
  ' ██████  ███████',
  '██       ██     ',
  '██  ████  █████ ',
  '██    ██  ██    ',
  ' ██████  ███████',
];
const LOGO_BRIGHT = [
  '  ██████   ██████  ███████',
  ' ██    ██ ██    ██ ██     ',
  ' ██    ██ ██    ██ ███████',
  ' ██    ██ ██    ██ ██     ',
  '  ██████   ██████  ███████',
];

interface Props {
  /** Terminal width — used to keep long lines from wrapping on narrow terms. */
  width?: number;
}

/**
 * v3.0.8 (opencode-style splash): full-screen first impression — centered
 * logo, the input lives just below it (rendered by the parent), and the
 * whole thing vertically centers in the remaining viewport.
 */
export const Splash = React.memo(function Splash({}: Props) {
  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <Box flexDirection="column" marginBottom={2}>
        {LOGO_DIM.map((row, i) => (
          <Box key={i}>
            <Text color={theme.textFaint}>{row}</Text>
            <Text color={theme.text} bold>{LOGO_BRIGHT[i]}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
});

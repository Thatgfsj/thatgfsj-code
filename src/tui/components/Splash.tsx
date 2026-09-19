/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

/**
 * Wordmark in ANSI Shadow (figlet), two-tone like opencode:
 * "gf" in dim gray, "code" in bright white. Generated once with figlet
 * and embedded verbatim — do not hand-edit the glyphs.
 * Both parts are exactly 6 rows and constant-width per part.
 */
const LOGO_DIM = [
  ' ██████╗ ███████╗',
  '██╔════╝ ██╔════╝',
  '██║  ███╗█████╗  ',
  '██║   ██║██╔══╝  ',
  '╚██████╔╝██║     ',
  ' ╚═════╝ ╚═╝     ',
];
const LOGO_BRIGHT = [
  ' ██████╗ ██████╗ ██████╗ ███████╗',
  '██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '██║     ██║   ██║██║  ██║█████╗  ',
  '██║     ██║   ██║██║  ██║██╔══╝  ',
  '╚██████╗╚██████╔╝██████╔╝███████╗',
  ' ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝',
];

interface Props {}

/**
 * v3.0.8 (opencode-style splash): centered wordmark on the first screen.
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

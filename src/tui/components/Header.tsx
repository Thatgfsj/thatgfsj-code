/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';
import { getVersion } from '../../version.js';
import { theme } from '../theme.js';

interface Props {
  /**
   * v3.0.0: optional cache hit-rate + estimated savings. When provided,
   * the header shows `⚡ 87% · ¥0.42` on the right side. When null (no
   * rounds yet, or provider does not surface usage), the right side just
   * shows the session info.
   */
  cacheHitRate?: number | null;
  cacheSavingsCNY?: number;
  /**
   * v3.0.3: cache TTL marker. '5m' (default for short sessions) or '1h'
   * (auto-decided for long sessions, or pinned by the user). 'auto' is
   * the user-pinned setting and shows up as ⏱ auto. null = not yet
   * decided (waiting for first round).
   */
  cacheTtl?: '5m' | '1h' | 'auto' | null;
  /** Terminal width for the rule line (v3.0.6). */
  width?: number;
}

/**
 * Choose a color for the hit-rate chip based on Reasonix-style thresholds:
 *   ≥ 80% green   (excellent — most of the prefix is being reused)
 *   ≥ 50% yellow  (partial hit — system prompt is cached but messages tail is not)
 *   < 50% gray    (cold — every round re-creates the cache; investigate)
 */
function hitRateColor(rate: number): string {
  if (rate >= 0.8) return theme.success;
  if (rate >= 0.5) return theme.warning;
  return theme.textDim;
}

/**
 * v3.0.6 (opencode-style): single flat brand line + thin rule. The model /
 * provider moved to the footer status bar; this line is only identity and
 * cache telemetry.
 */
export const Header = React.memo(function Header({ cacheHitRate, cacheSavingsCNY, cacheTtl, width }: Props) {
  const showCache = typeof cacheHitRate === 'number' && cacheHitRate > 0;
  const rule = '─'.repeat(Math.max(20, width ? width - 2 : 78));

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box justifyContent="space-between" width="100%">
        <Box>
          <Text color={theme.accent} bold>◆ </Text>
          <Text color={theme.text} bold>THATGFSJ</Text>
          <Text color={theme.textDim}> v{getVersion()}</Text>
        </Box>
        <Box>
          {showCache && (
            <>
              <Text color={hitRateColor(cacheHitRate!)}>⚡ {(cacheHitRate! * 100).toFixed(1)}%</Text>
              <Text color={theme.textDim}> · ¥{(cacheSavingsCNY ?? 0).toFixed(2)}</Text>
              <Text color={theme.textFaint}> · </Text>
            </>
          )}
          {cacheTtl && <Text color={theme.textDim}>⏱ {cacheTtl}</Text>}
        </Box>
      </Box>
      <Text color={theme.border}>{rule}</Text>
    </Box>
  );
});

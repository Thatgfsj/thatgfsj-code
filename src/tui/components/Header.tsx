/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  provider: string;
  model: string;
  /**
   * v3.0.0: optional cache hit-rate + estimated savings. When provided,
   * the header shows `⚡ 命中率 87% · 节省 ¥0.42` on the right side. When
   * null (no rounds yet, or provider does not surface usage), the right
   * side just shows provider/model.
   */
  cacheHitRate?: number | null;
  cacheSavingsCNY?: number;
}

/**
 * Choose a color for the hit-rate chip based on Reasonix-style thresholds:
 *   ≥ 80% green   (excellent — most of the prefix is being reused)
 *   ≥ 50% yellow  (partial hit — system prompt is cached but messages tail is not)
 *   < 50% gray    (cold — every round re-creates the cache; investigate)
 */
function hitRateColor(rate: number): string {
  if (rate >= 0.8) return '#10B981';
  if (rate >= 0.5) return '#F59E0B';
  return '#6B7280';
}

export const Header = React.memo(function Header({ provider, model, cacheHitRate, cacheSavingsCNY }: Props) {
  const showCache = typeof cacheHitRate === 'number' && cacheHitRate > 0;
  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box justifyContent="space-between" width="100%">
        <Box>
          <Text color="#06B6D4" bold> ⚡ </Text>
          <Text color="#22D3EE" bold>THATGFSJ CODE</Text>
          <Text dimColor> v3.0.0</Text>
        </Box>
        <Box>
          {showCache && (
            <>
              <Text color={hitRateColor(cacheHitRate!)} bold> ⚡ {(cacheHitRate! * 100).toFixed(1)}% </Text>
              <Text dimColor> · 节省 ¥{(cacheSavingsCNY ?? 0).toFixed(2)} </Text>
              <Text dimColor> · </Text>
            </>
          )}
          <Text color="#06B6D4" bold> {provider} </Text>
          <Text dimColor>/</Text>
          <Text color="#22D3EE"> {model} </Text>
        </Box>
      </Box>
      <Text color="#374151">{'─'.repeat(80)}</Text>
    </Box>
  );
});

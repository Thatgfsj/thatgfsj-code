/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import { formatTokens } from '../../utils/tokens.js';

export interface SessionStats {
  /** Last round's prompt tokens = current context size. */
  contextTokens: number;
  /** Model context window (tokens) — percentage shown against this. */
  contextWindow: number;
  /** Cumulative input tokens across the session. */
  inTokens: number;
  /** Cumulative output (completion) tokens across the session. */
  outTokens: number;
  savingsCNY: number;
}

interface Props {
  messageCount: number;
  skills: string[];
  /** Current provider/model id (v3.0.6 — moved here from Header). */
  provider?: string;
  model?: string;
  /** v3.0.13: session token accounting for the right side of the bar. */
  stats?: SessionStats;
}

/**
 * v3.0.13 (opencode-style footer): one status line.
 * left: provider/model · right: context usage, session tokens, message
 * count. This is the "session consumption" area of the screen.
 */
export const StatusBar = React.memo(function StatusBar({ messageCount, skills, provider, model, stats }: Props) {
  const activeSkills = skills.slice(0, 3).join(', ');
  const moreSkills = skills.length > 3 ? ` +${skills.length - 3}` : '';

  let ctxChip: string | null = null;
  let ctxColor: string = theme.textDim;
  if (stats && stats.contextTokens > 0 && stats.contextWindow > 0) {
    const pct = Math.min(999, Math.round((stats.contextTokens / stats.contextWindow) * 100));
    ctxChip = `ctx ${formatTokens(stats.contextTokens)}/${formatTokens(stats.contextWindow)} (${pct}%)`;
    if (pct >= 85) ctxColor = theme.error;
    else if (pct >= 60) ctxColor = theme.warning;
    else ctxColor = theme.success;
  }

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
          {ctxChip && <Text color={ctxColor}>{ctxChip}</Text>}
          {ctxChip && <Text color={theme.textFaint}> · </Text>}
          {stats && (
            <Text color={theme.textFaint}>↑{formatTokens(stats.inTokens)} ↓{formatTokens(stats.outTokens)} · 节省 ¥{stats.savingsCNY.toFixed(2)} · </Text>
          )}
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

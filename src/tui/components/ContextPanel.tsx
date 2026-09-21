/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

export interface ContextCategory {
  label: string;
  tokens: number;
}

interface Props {
  /** Tokens occupied in the context window (last round's real usage). */
  used: number;
  /** Model context window in tokens. */
  window: number;
  /** 0..1 SESSION cache hit rate; null before the first round. */
  hitRate: number | null;
  /** SESSION cumulative ↑ input tokens. */
  inTokens: number;
  /** SESSION cumulative ↓ output tokens. */
  outTokens: number;
  /** Session message window (/models 上下文长度). */
  maxMessages?: number;
  /** Ordered categories; 「其他」 (remainder to `used`) is appended. */
  categories?: ContextCategory[];
  width?: number;
  /** Date/title line, opencode "New session — <date>" parity. */
  title?: string;
}

/** 33000 → "3.3万", 200000 → "20万". */
function fmtWan(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 10000) return String(Math.round(n));
  const w = n / 10000;
  const s = w >= 100 ? String(Math.round(w)) : w.toFixed(1).replace(/\.0$/, '');
  return `${s}万`;
}

function fmtPct(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '0%';
  const p = ratio * 100;
  return p >= 10 ? `${p.toFixed(1).replace(/\.0$/, '')}%` : `${Math.round(p * 10) / 10}%`;
}

/**
 * v3.4.16: the right sidebar is BACK (user request, opencode parity) — now
 * living inside the inline live region, so it pins to the viewport while
 * the transcript scrolls in the terminal scrollback. SESSION numbers only:
 * everything here resets per session so it always matches what the user
 * actually did (the lifetime store stays behind /cache).
 */
export function ContextPanel({ used, window: win, hitRate, inTokens, outTokens, maxMessages, categories = [], width = 36, title }: Props) {
  const total = Math.max(0, used);
  const sumKnown = categories.reduce((a, c) => a + Math.max(0, c.tokens), 0);
  const rows: ContextCategory[] = [
    ...categories,
    { label: '其他', tokens: Math.max(0, total - sumKnown) },
  ].filter(c => c.tokens > 0 || c.label === '消息');
  const ratio = win > 0 ? Math.min(1, total / win) : 0;
  const barWidth = width - 2;
  const filled = Math.max(0, Math.min(barWidth, Math.round(ratio * barWidth)));

  return (
    <Box flexDirection="column" width={width} flexShrink={0} paddingLeft={1}>
      {title && <Text color={theme.textDim} wrap="truncate-end">{title}</Text>}
      <Text color={theme.text} bold> </Text>
      <Text color={theme.text}>上下文</Text>
      <Text color={theme.textDim}>{fmtWan(total)} / {fmtWan(win)} tokens</Text>
      <Text color={theme.textDim}>{fmtPct(ratio)} used</Text>
      <Box marginTop={0} marginBottom={1}>
        <Text color={theme.accent}>{'━'.repeat(filled)}</Text>
        <Text color={theme.border}>{'━'.repeat(barWidth - filled)}</Text>
      </Box>
      {rows.map(c => (
        <Box key={c.label} justifyContent="space-between">
          <Text color={theme.textDim}>· {c.label}</Text>
          <Text color={theme.textDim}>{fmtPct(total > 0 ? c.tokens / total : 0)}</Text>
        </Box>
      ))}
      <Text color={theme.text} bold> </Text>
      <Box justifyContent="space-between">
        <Text color={theme.textDim}>↑ 输入</Text>
        <Text color={theme.textDim}>{fmtWan(inTokens)}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text color={theme.textDim}>↓ 输出</Text>
        <Text color={theme.textDim}>{fmtWan(outTokens)}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text color={theme.textDim}>缓存命中</Text>
        <Text color={theme.textDim}>{hitRate === null ? '—' : `${Math.round(hitRate * 100)}%`}</Text>
      </Box>
      {maxMessages !== undefined && (
        <Box justifyContent="space-between">
          <Text color={theme.textDim}>回合窗口</Text>
          <Text color={theme.textDim}>{maxMessages} 条</Text>
        </Box>
      )}
    </Box>
  );
}

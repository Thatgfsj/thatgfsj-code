/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

export interface ContextCategory {
  label: string;
  tokens: number;
}

interface Props {
  /** Tokens occupied in the context window (real usage when known). */
  used: number;
  /** Model context window in tokens. */
  window: number;
  /** 0..1 rolling cache hit rate; null when no round has completed yet. */
  hitRate: number | null;
  /** Cumulative input tokens across the session (↑). */
  inTokens: number;
  /** Cumulative output tokens across the session (↓). */
  outTokens: number;
  /** Ordered categories; 「其他」 (remainder to `used`) is appended here. */
  categories: ContextCategory[];
  width?: number;
  /** Session message window (the /models 上下文长度 setting), shown live. */
  maxMessages?: number;
  /** v3.4.11: max body rows — the panel must never stretch the frame. */
  maxRows?: number;
}

/** 33000 → "3.3万", 200000 → "20万", 950 → "950" (万 units, opencode-style). */
function fmtWan(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 10000) return String(Math.round(n));
  const w = n / 10000;
  const s = w >= 100 ? String(Math.round(w)) : w.toFixed(1).replace(/\.0$/, '');
  return `${s}万`;
}

/** 16.3% style: one decimal, trailing .0 trimmed. */
function fmtPct(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '0%';
  const p = ratio * 100;
  return p >= 10 ? `${p.toFixed(1).replace(/\.0$/, '')}%` : `${Math.round(p * 10) / 10}%`;
}

/**
 * v3.2.1: right-side info panel (opencode parity — the screenshot the user
 * asked for). Total occupancy against the model window, a bar, a
 * share-of-used category breakdown, session ↑ input / ↓ output totals and
 * the rolling cache hit rate. NO cost/money line (user explicitly removed
 * it). Pure display — numbers are computed by the caller.
 */
export function ContextPanel({ used, window: win, hitRate, inTokens, outTokens, categories, width = 38, maxMessages, maxRows = 16 }: Props) {
  const total = Math.max(0, used);
  const sumKnown = categories.reduce((a, c) => a + Math.max(0, c.tokens), 0);
  const rows: ContextCategory[] = [
    ...categories,
    { label: '其他', tokens: Math.max(0, total - sumKnown) },
  ];
  // v3.4.11: cap the body so header+bar+categories+rule+stats ≤ maxRows —
  // an over-tall panel used to stretch the frame past the viewport and
  // smear itself across the chat column.
  const statsRows = maxMessages === undefined ? 3 : 4;
  const catBudget = Math.max(2, maxRows - 5 - statsRows);
  const shown: ContextCategory[] = rows.slice(0, catBudget);
  const hiddenCats = rows.length - shown.length;
  const ratio = win > 0 ? Math.min(1, total / win) : 0;
  const barWidth = width - 2;
  const filled = Math.max(0, Math.min(barWidth, Math.round(ratio * barWidth)));

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Box justifyContent="space-between">
        <Text color={theme.text}>上下文容量</Text>
        <Text color={theme.textDim}>{fmtWan(total)}/{fmtWan(win)} ({fmtPct(ratio)})</Text>
      </Box>
      <Box marginTop={0} marginBottom={1}>
        <Text color={theme.accent}>{'━'.repeat(filled)}</Text>
        <Text color={theme.border}>{'━'.repeat(barWidth - filled)}</Text>
      </Box>
      {shown.map(c => (
        <Box key={c.label} justifyContent="space-between">
          <Text color={theme.textDim}>● {c.label}</Text>
          <Text color={theme.textDim}>{fmtPct(total > 0 ? c.tokens / total : 0)}</Text>
        </Box>
      ))}
      {hiddenCats > 0 && (
        <Text color={theme.textFaint}>  … {hiddenCats} 类</Text>
      )}
      <Box marginTop={1}>
        <Text color={theme.border}>{'─'.repeat(width - 2)}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text color={theme.textDim}>↑ 输入</Text>
        <Text color={theme.textDim}>{fmtWan(inTokens)}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text color={theme.textDim}>↓ 输出</Text>
        <Text color={theme.textDim}>{fmtWan(outTokens)}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text color={theme.textDim}>平均缓存命中率</Text>
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

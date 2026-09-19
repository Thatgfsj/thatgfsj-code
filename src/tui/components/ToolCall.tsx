/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

interface ToolCallData {
  name: string;
  args: string;
  result?: string;
  isError?: boolean;
}

interface Props {
  tool: ToolCallData;
  width?: number;
}

/**
 * Compact one-line arg preview per tool, opencode-style:
 *   ⎿ shell(npm test)
 *   ⎿ file(write src/app.ts)
 *
 * v3.0.16: exported pure function — also drives the append-only streaming
 * writer in useChat (direct stdout writes share the exact formatting the
 * <Static>-rendered ToolCall component uses, so scrollback looks identical
 * no matter which path produced the line).
 */
export function formatToolLabel(name: string, args: string): { title: string; detail: string } {
  try {
    const obj = JSON.parse(args);
    switch (name) {
      case 'file':
        return { title: `${obj.action || 'file'}`, detail: obj.path || '' };
      case 'shell':
        return { title: 'shell', detail: obj.command?.slice(0, 70) || '' };
      case 'git':
        return { title: `git ${obj.action || ''}`.trim(), detail: obj.message ? `"${String(obj.message).slice(0, 50)}"` : (obj.args || '') };
      case 'search':
        return { title: obj.action || 'search', detail: obj.pattern || obj.query || '' };
      case 'nwt':
        return { title: `nwt ${obj.action || ''}`.trim(), detail: obj.task || obj.query || '' };
      case 'browser': {
        // v3.0.16: browser tool got its own label shape.
        //   search → `browser search (bing)` + "query"
        //   open   → `browser open` + url
        //   close  → `browser close`
        const action = String(obj.action || 'browser').toLowerCase();
        if (action === 'search') {
          const engine = String(obj.engine || 'bing').toLowerCase();
          return { title: `browser search (${engine})`, detail: obj.query ? `"${String(obj.query).slice(0, 60)}"` : '' };
        }
        if (action === 'open') {
          return { title: 'browser open', detail: String(obj.url || '').slice(0, 70) };
        }
        if (action === 'close') {
          return { title: 'browser close', detail: '' };
        }
        return { title: `browser ${action}`, detail: '' };
      }
      default: {
        if (name.startsWith('mcp__')) {
          const short = name.replace(/^mcp__/, '').replace(/__/, ' · ');
          return { title: short, detail: Object.keys(obj).slice(0, 2).map(k => `${k}=${JSON.stringify(obj[k])}`.slice(0, 40)).join(' ') };
        }
        return { title: name, detail: Object.keys(obj).slice(0, 2).join(', ') };
      }
    }
  } catch {
    return { title: name, detail: (args || '').slice(0, 50) };
  }
}

/**
 * v3.0.16: the result summary line under a `⎿` call line, extracted from the
 * ToolCall component so the streaming writer can paint the same summary as
 * plain text. Pure: (result, isError) → line text + theme color, or null
 * while the call is still running (result undefined).
 */
export function formatToolResultLine(result: string, isError: boolean): { text: string; color: string } | null {
  const lines = result.split('\n').filter(l => l.trim());
  if (isError) {
    return { text: lines[0]?.slice(0, 90) || 'failed', color: theme.error };
  }
  if (lines.length === 0) {
    return { text: 'ok (no output)', color: theme.textFaint };
  }
  if (lines.length <= 2) {
    return { text: lines.join(' · ').slice(0, 100), color: theme.textDim };
  }
  return { text: `${lines.length} 行 · ${lines[0].slice(0, 70)}`, color: theme.textFaint };
}

/**
 * v3.0.16: the pre-execution `⎿ name(args) ⟳` line painted by the streaming
 * writer the moment a pending tool_calls chunk arrives. Pure and
 * color-free (callers add theme colors with chalk).
 */
export function formatToolPendingText(name: string, args: string): string {
  const { title, detail } = formatToolLabel(name, args);
  return `⎿ ${title}${detail ? ` ${detail}` : ''} ⟳`;
}

/**
 * v3.0.6 (opencode-style): tool calls render as a dim `⎿` continuation
 * line with a compact result summary — 2 lines of output (or the error),
 * not a full panel. The full text stays in the conversation history.
 */
export function ToolCall({ tool }: Props) {
  const { title, detail } = formatToolLabel(tool.name, tool.args);
  const running = tool.result === undefined;
  const resultLine = tool.result !== undefined
    ? formatToolResultLine(tool.result, !!tool.isError)
    : null;

  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={0}>
      <Box>
        <Text color={theme.toolMark}>⎿ </Text>
        <Text color={theme.accentDim}>{title}</Text>
        {detail && <Text color={theme.textDim}> {detail}</Text>}
        {running && <Text color={theme.textFaint}> ⟳</Text>}
      </Box>
      {resultLine && (
        <Box paddingLeft={2}>
          <Text color={resultLine.color} wrap="truncate-end">{resultLine.text}</Text>
        </Box>
      )}
    </Box>
  );
}

export type { ToolCallData };

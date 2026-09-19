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
 */
function formatToolLabel(name: string, args: string): { title: string; detail: string } {
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
 * v3.0.6 (opencode-style): tool calls render as a dim `⎿` continuation
 * line with a compact result summary — 2 lines of output (or the error),
 * not a full panel. The full text stays in the conversation history.
 */
export function ToolCall({ tool }: Props) {
  const { title, detail } = formatToolLabel(tool.name, tool.args);
  const running = tool.result === undefined;

  let resultLine: { text: string; color: string } | null = null;
  if (tool.result !== undefined) {
    const lines = tool.result.split('\n').filter(l => l.trim());
    if (tool.isError) {
      resultLine = { text: lines[0]?.slice(0, 90) || 'failed', color: theme.error };
    } else if (lines.length === 0) {
      resultLine = { text: 'ok (no output)', color: theme.textFaint };
    } else if (lines.length <= 2) {
      resultLine = { text: lines.join(' · ').slice(0, 100), color: theme.textDim };
    } else {
      resultLine = { text: `${lines.length} 行 · ${lines[0].slice(0, 70)}`, color: theme.textFaint };
    }
  }

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

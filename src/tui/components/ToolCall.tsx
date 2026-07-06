/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';

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

function formatToolName(name: string, args: string): string {
  try {
    const obj = JSON.parse(args);
    switch (name) {
      case 'file': {
        const action = obj.action || '';
        const path = (obj.path || '').replace(/.*[/\\]/, '');
        return `${action} ${path || obj.path || ''}`;
      }
      case 'shell': return obj.command?.slice(0, 60) || '';
      case 'git': return obj.command || '';
      case 'search': return obj.query || obj.pattern || '';
      case 'nwt': return obj.action || '';
      default: return Object.keys(obj).slice(0, 2).join(', ');
    }
  } catch {
    return '';
  }
}

function truncateOutput(output: string, maxLines = 8): { text: string; truncated: boolean } {
  const lines = output.split('\n');
  if (lines.length <= maxLines) return { text: output, truncated: false };
  return { text: lines.slice(0, maxLines).join('\n'), truncated: true };
}

export function ToolCall({ tool }: Props) {
  const label = formatToolName(tool.name, tool.args);
  const result = tool.result ? truncateOutput(tool.result) : null;

  return (
    <Box flexDirection="column" marginBottom={0} paddingLeft={1}>
      {/* Tool header */}
      <Box>
        <Text color="#06B6D4" bold>⚙ </Text>
        <Text color="#06B6D4">{tool.name}</Text>
        {label && <Text color="#64748B"> {label}</Text>}
      </Box>

      {/* Result */}
      {result && (
        <Box paddingLeft={2} flexDirection="column">
          {result.text.split('\n').map((line, i) => (
            <Text key={i} color={tool.isError ? '#EF4444' : '#64748B'} wrap="truncate">
              {line}
            </Text>
          ))}
          {result.truncated && <Text dimColor>  ...</Text>}
        </Box>
      )}
    </Box>
  );
}

export type { ToolCallData };

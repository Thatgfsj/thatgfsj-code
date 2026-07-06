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

export function ToolCall({ tool, width }: Props) {
  const label = formatToolName(tool.name, tool.args);
  const result = tool.result !== undefined ? truncateOutput(tool.result) : null;

  return (
    <Box flexDirection="column" marginBottom={0} paddingLeft={1}>
      {/* Tool header */}
      <Box>
        <Text color="#06B6D4" bold>⚙ </Text>
        <Text color="#06B6D4">{tool.name}</Text>
        {label && <Text color="#64748B"> {label}</Text>}
      </Box>

      {/* Result — v2.2.6 fix:
          - Use `!== undefined` (not truthy) so empty string results
            still render (truthy check dropped them, making it look
            like the tool result was missing).
          - Switch wrap from "truncate" to "wrap" so long lines don't
            silently disappear off-screen.
          - Always render the Box even when result is empty (just
            with a "(no output)" marker), so the visual frame stays
            consistent.
          - If truncated, show explicit "(+N more lines)" indicator
            so users know the result was clipped. */}
      {result !== null && (
        <Box paddingLeft={2} flexDirection="column">
          {result.text.length === 0 ? (
            <Text color="#94A3B8" dimColor>(no output)</Text>
          ) : (
            <>
              {result.text.split('\n').map((line, i) => (
                <Text
                  key={i}
                  color={tool.isError ? '#EF4444' : '#64748B'}
                  wrap="wrap"
                >
                  {line || ' '}
                </Text>
              ))}
              {result.truncated && (
                <Text color="#94A3B8" dimColor>
                  {'  '}(+{tool.result!.split('\n').length - 8} more lines)
                </Text>
              )}
            </>
          )}
        </Box>
      )}
      {/* v2.2.6: if result is undefined (still running), show a
          pending indicator so the user knows the tool is in flight. */}
      {result === null && tool.result === undefined && (
        <Box paddingLeft={2}>
          <Text color="#94A3B8" dimColor>  ⏳ running...</Text>
        </Box>
      )}
    </Box>
  );
}

export type { ToolCallData };

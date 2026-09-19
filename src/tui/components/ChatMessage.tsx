/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';
import { Markdown } from './Markdown.js';
import { ToolCall, type ToolCallData } from './ToolCall.js';
import { theme } from '../theme.js';

interface MessageData {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCallData[];
}

interface Props {
  message: MessageData;
  width?: number;
  /** v3.0.9: shown on the assistant label line, opencode-style. */
  mode?: string;
  model?: string;
}

/**
 * v3.0.9 (opencode session view): the USER message is the prominent block —
 * left accent bar + plain text; the ASSISTANT reply is quiet — a dim
 * `▪ Build · model` label over the markdown body, with tool calls as
 * `⎿` continuation lines above it.
 */
function UserMessage({ content }: { content: string }) {
  return (
    <Box
      marginBottom={1}
      borderLeft
      borderLeftColor={theme.accent}
      borderStyle="bold"
      paddingLeft={1}
      paddingRight={1}
    >
      <Text color={theme.text}>{content}</Text>
    </Box>
  );
}

function AssistantMessage({ content, toolCalls, mode, model }: { content: string; toolCalls?: ToolCallData[]; mode?: string; model?: string }) {
  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
      {toolCalls && toolCalls.map((tc, i) => (
        <ToolCall key={i} tool={tc} />
      ))}
      {content && (
        <Box flexDirection="column">
          <Text color={theme.textFaint}>▪ {mode ?? 'Build'}{model ? ` · ${model}` : ''}</Text>
          <Markdown content={content} />
        </Box>
      )}
    </Box>
  );
}

export const ChatMessage = React.memo(function ChatMessage({ message, mode, model }: Props) {
  if (message.role === 'user') {
    return <UserMessage content={message.content} />;
  }
  return <AssistantMessage content={message.content} toolCalls={message.toolCalls} mode={mode} model={model} />;
});

export type { MessageData };

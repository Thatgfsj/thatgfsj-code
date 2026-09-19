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
}

/**
 * v3.0.6 (opencode-style): no "You"/"AI" headers, no boxes.
 * user      → dim `❯` mark + plain text
 * assistant → accent `⏺` bullet + markdown body, tool calls as
 *             `⎿ tool(args)` continuation lines above the text
 */
function UserMessage({ content }: { content: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={theme.userMark} bold>❯ </Text>
        <Text color={theme.text}>{content}</Text>
      </Box>
    </Box>
  );
}

function AssistantMessage({ content, toolCalls }: { content: string; toolCalls?: ToolCallData[] }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {toolCalls && toolCalls.map((tc, i) => (
        <ToolCall key={i} tool={tc} />
      ))}
      {content && (
        <Box>
          <Text color={theme.assistantMark}>⏺ </Text>
          <Box flexDirection="column">
            <Markdown content={content} />
          </Box>
        </Box>
      )}
    </Box>
  );
}

export const ChatMessage = React.memo(function ChatMessage({ message }: Props) {
  if (message.role === 'user') {
    return <UserMessage content={message.content} />;
  }
  return <AssistantMessage content={message.content} toolCalls={message.toolCalls} />;
});

export type { MessageData };

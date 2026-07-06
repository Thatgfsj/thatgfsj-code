/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';
import { Markdown } from './Markdown.js';
import { ToolCall, type ToolCallData } from './ToolCall.js';

interface MessageData {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCallData[];
}

interface Props {
  message: MessageData;
  width?: number;
}

function UserMessage({ content }: { content: string }) {
  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
      <Text bold color="#06B6D4">You</Text>
      <Box paddingLeft={2}>
        <Text>{content}</Text>
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
        <Box flexDirection="column" paddingLeft={1}>
          <Text bold color="#22D3EE">AI</Text>
          <Box paddingLeft={2}>
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

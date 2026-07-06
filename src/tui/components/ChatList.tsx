/** @jsxImportSource react */
import React, { memo } from 'react';
import { Box, Static } from 'ink';
import { ChatMessage, type MessageData } from './ChatMessage.js';
import type { ToolCallData } from './ToolCall.js';

interface Props {
  messages: MessageData[];
  streaming?: string;
  streamingToolCalls?: ToolCallData[];
  width?: number;
}

export const ChatList = memo(function ChatList({ messages, streaming, streamingToolCalls, width }: Props) {
  const hasStreaming = !!(streaming || (streamingToolCalls && streamingToolCalls.length > 0));

  return (
    <Box flexDirection="column">
      {/* Completed messages - Static prevents re-rendering */}
      {messages.length > 0 && (
        <Static items={messages}>
          {(msg: MessageData, index: number) => (
            <ChatMessage key={`msg-${index}`} message={msg} width={width} />
          )}
        </Static>
      )}

      {/* Streaming content - only this part re-renders */}
      {hasStreaming && (
        <ChatMessage
          message={{
            role: 'assistant',
            content: streaming || '',
            toolCalls: streamingToolCalls && streamingToolCalls.length > 0 ? streamingToolCalls : undefined,
          }}
          width={width}
        />
      )}
    </Box>
  );
});

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
  /** v3.0.9: assistant label info (opencode session view). */
  mode?: string;
  model?: string;
}

/**
 * v3.0.13: completed messages render through Ink <Static> — printed ONCE
 * into the terminal's scroll buffer and never touched again. History stays
 * visible indefinitely (scroll back freely); nothing is ever folded or
 * erased. Only the streaming tail + input live in the re-rendered frame.
 *
 * (3.0.9 tried a sliced viewport inside a fixed-height fullscreen frame;
 * the user rejected it — history must stay visible, not fold after ~10
 * messages.)
 */
export const ChatList = memo(function ChatList({ messages, streaming, streamingToolCalls, width, mode, model }: Props) {
  const hasStreaming = !!(streaming || (streamingToolCalls && streamingToolCalls.length > 0));

  return (
    <Box flexDirection="column">
      {messages.length > 0 && (
        <Static items={messages}>
          {(msg: MessageData, index: number) => (
            <ChatMessage key={`msg-${index}`} message={msg} width={width} mode={mode} model={model} />
          )}
        </Static>
      )}
      {hasStreaming && (
        <ChatMessage
          message={{
            role: 'assistant',
            content: streaming || '',
            toolCalls: streamingToolCalls && streamingToolCalls.length > 0 ? streamingToolCalls : undefined,
          }}
          width={width}
          mode={mode}
          model={model}
        />
      )}
    </Box>
  );
});

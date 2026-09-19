/** @jsxImportSource react */
import React, { memo } from 'react';
import { Box, Static } from 'ink';
import { ChatMessage, type MessageData } from './ChatMessage.js';

interface Props {
  messages: MessageData[];
  width?: number;
  /** v3.0.9: assistant label info (opencode session view). */
  mode?: string;
  model?: string;
}

/**
 * v3.0.13: completed messages render through Ink <Static> — printed ONCE
 * into the terminal's scroll buffer and never touched again. History stays
 * visible indefinitely (scroll back freely); nothing is ever folded or
 * erased.
 *
 * v3.0.16 (scroll-wheel fix): this component now renders EXCLUSIVELY
 * <Static> items, so it contributes ZERO lines to the re-rendered frame.
 * Streaming text/tool lines are appended directly to the scrollback by
 * useChat (claude-code two-region rendering) — the live frame is just the
 * spinner + input + status bar, at constant height while a response
 * streams. The old `streaming`/`streamingToolCalls` live-frame branches
 * are gone (they were the root cause of the wheel lockup: the frame grew
 * with every token and Ink's full-frame redraw yanked the viewport down).
 */
export const ChatList = memo(function ChatList({ messages, width, mode, model }: Props) {
  return (
    <Box flexDirection="column">
      {messages.length > 0 && (
        <Static items={messages}>
          {(msg: MessageData, index: number) => (
            <ChatMessage key={`msg-${index}`} message={msg} width={width} mode={mode} model={model} />
          )}
        </Static>
      )}
    </Box>
  );
});

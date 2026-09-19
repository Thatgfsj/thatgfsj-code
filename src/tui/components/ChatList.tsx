/** @jsxImportSource react */
import React, { memo } from 'react';
import { Box, Static, Text } from 'ink';
import { ChatMessage, type MessageData } from './ChatMessage.js';
import type { ToolCallData } from './ToolCall.js';
import { theme } from '../theme.js';

interface Props {
  messages: MessageData[];
  streaming?: string;
  streamingToolCalls?: ToolCallData[];
  width?: number;
  /**
   * v3.0.9: viewport height (in terminal rows). When provided, the list
   * renders the most recent messages that fit — WITHOUT Ink <Static>.
   *
   * Why: Static prints items once above the re-rendered frame, and a
   * full-terminal-height frame erases them on the next repaint (messages
   * "flash and disappear" in fullscreen mode). In viewport mode messages
   * are ordinary tree children of the fixed-height frame, exactly like
   * opencode's managed viewport.
   *
   * When omitted (headless/legacy), falls back to Static.
   */
  viewportHeight?: number;
  /** v3.0.9: assistant label info (opencode session view). */
  mode?: string;
  model?: string;
}

/** Rough line estimate for a rendered message (wrapping + chrome). */
function estimateLines(m: MessageData, width: number): number {
  const w = Math.max(20, width - 4);
  let lines = 0;
  if (m.role === 'user') {
    lines += 1 + Math.max(1, Math.ceil(m.content.length / w));
  } else {
    for (const tc of m.toolCalls ?? []) {
      lines += 1 + (tc.result !== undefined ? 1 : 0);
    }
    if (m.content) {
      const srcLines = m.content.split('\n').length;
      lines += 2 + srcLines + Math.ceil(m.content.length / w); // +1 label line
    }
  }
  return lines + 1; // marginBottom spacing
}

/**
 * v3.0.9: slice the newest messages that fit the viewport budget.
 * Returns [hiddenCount, visibleMessages].
 */
export function sliceForViewport(messages: MessageData[], height: number, width: number): [number, MessageData[]] {
  let budget = Math.max(3, height);
  let i = messages.length;
  while (i > 0) {
    const cost = estimateLines(messages[i - 1], width);
    if (budget - cost < 0) break;
    budget -= cost;
    i--;
  }
  return [i, messages.slice(i)];
}

export const ChatList = memo(function ChatList({ messages, streaming, streamingToolCalls, width, viewportHeight, mode, model }: Props) {
  const hasStreaming = !!(streaming || (streamingToolCalls && streamingToolCalls.length > 0));

  // ── viewport mode (fullscreen TUI) ──
  if (viewportHeight !== undefined) {
    const w = width || 80;
    const streamingMsg: MessageData | null = hasStreaming
      ? {
          role: 'assistant',
          content: streaming || '',
          toolCalls: streamingToolCalls && streamingToolCalls.length > 0 ? streamingToolCalls : undefined,
        }
      : null;
    // The in-flight streaming block shares the viewport budget.
    const budget = Math.max(3, viewportHeight - (streamingMsg ? estimateLines(streamingMsg, w) : 0));
    const [hidden, visible] = sliceForViewport(messages, budget, w);

    return (
      <Box flexDirection="column" overflow="hidden">
        {hidden > 0 && (
          <Text color={theme.textFaint}>… 已折叠较早的 {hidden} 条消息（/resume 或 /new 管理）</Text>
        )}
        {visible.map((msg, i) => (
          <ChatMessage key={`msg-${messages.length - visible.length + i}`} message={msg} width={w} mode={mode} model={model} />
        ))}
        {streamingMsg && (
          <ChatMessage message={streamingMsg} width={w} mode={mode} model={model} />
        )}
      </Box>
    );
  }

  // ── Static mode (legacy/headless) ──
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

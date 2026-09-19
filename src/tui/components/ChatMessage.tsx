/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';
import { Markdown } from './Markdown.js';
import { ToolCall, type ToolCallData } from './ToolCall.js';
import { theme } from '../theme.js';
import { estimateTokens, formatTokens } from '../../utils/tokens.js';

interface MessageData {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCallData[];
  /**
   * v3.0.13: real completion tokens for this assistant turn (summed across
   * agent-loop rounds). User messages show a heuristic estimate instead.
   */
  tokens?: number;
  /**
   * v3.0.18: plain items render as a single unadorned Text (no assistant
   * label, no markdown) — used by streamed chunks, tool lines, chips and
   * stats committed into the Static list. dim renders them faint.
   */
  plain?: boolean;
  dim?: boolean;
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
      <Text color={theme.textFaint}>  ~{estimateTokens(content)}t</Text>
    </Box>
  );
}

function AssistantMessage({ content, toolCalls, mode, model, tokens, width }: { content: string; toolCalls?: ToolCallData[]; mode?: string; model?: string; tokens?: number; width?: number }) {
  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
      {toolCalls && toolCalls.map((tc, i) => (
        <ToolCall key={i} tool={tc} />
      ))}
      {content && (
        <Box flexDirection="column">
          <Text color={theme.textFaint}>
            ▪ {mode ?? 'Build'}{model ? ` · ${model}` : ''}
            {tokens ? ` · ${formatTokens(tokens)}t` : ''}
          </Text>
          <Markdown content={content} width={width} />
        </Box>
      )}
    </Box>
  );
}

export const ChatMessage = React.memo(function ChatMessage({ message, mode, model, width }: Props) {
  if (message.role === 'user') {
    return <UserMessage content={message.content} />;
  }
  // v3.0.18: plain Static items (streamed chunks, tool lines, chips, stats).
  if (message.plain) {
    return (
      <Box marginBottom={0}>
        <Text color={message.dim ? theme.textFaint : theme.text}>{message.content}</Text>
      </Box>
    );
  }
  // v3.2.1: width flows down so the answer wraps at the WORKSPACE width,
  // not marked-terminal's 80-column default.
  return <AssistantMessage content={message.content} toolCalls={message.toolCalls} mode={mode} model={model} tokens={message.tokens} width={width} />;
});

export type { MessageData };

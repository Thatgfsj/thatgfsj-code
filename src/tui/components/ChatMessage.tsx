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

function AssistantMessage({ content, toolCalls, mode, model, tokens }: { content: string; toolCalls?: ToolCallData[]; mode?: string; model?: string; tokens?: number }) {
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
  return <AssistantMessage content={message.content} toolCalls={message.toolCalls} mode={mode} model={model} tokens={message.tokens} />;
});

export type { MessageData };

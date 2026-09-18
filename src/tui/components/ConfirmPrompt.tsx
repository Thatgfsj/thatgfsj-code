/** @jsxImportSource react */
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface Props {
  /** Full confirmation message (may contain a diff preview). */
  message: string;
  onAnswer: (allowed: boolean, alwaysAllow: boolean) => void;
}

/**
 * v3.0.5: the permission prompt. Rendered INSTEAD of UserInput while a
 * confirmation is pending, so Ink's useInput broadcast can not double-feed
 * keystrokes into the chat box (the old architecture had UserInput always
 * active — every 'y'/'n' also landed in the input field, and ESC aborted
 * the stream mid-confirmation).
 *
 * Keys: y = allow once, a = allow everything this session (accept mode),
 * n / ESC = deny.
 */
export function ConfirmPrompt({ message, onAnswer }: Props) {
  const [answered, setAnswered] = useState(false);

  useInput((input, key) => {
    if (answered) return;

    if (input === 'y' || input === 'Y' || key.return) {
      setAnswered(true);
      onAnswer(true, false);
      return;
    }
    if (input === 'a' || input === 'A') {
      setAnswered(true);
      onAnswer(true, true);
      return;
    }
    if (input === 'n' || input === 'N' || key.escape) {
      setAnswered(true);
      onAnswer(false, false);
      return;
    }
  });

  const lines = message.split('\n');

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#F59E0B"
      paddingX={1}
      marginBottom={0}
    >
      <Text color="#F59E0B" bold>⚠ 权限确认</Text>
      {lines.slice(0, 40).map((line, i) => {
        const isAdd = line.startsWith('+');
        const isDel = line.startsWith('-');
        return (
          <Text key={i} color={isAdd ? '#10B981' : isDel ? '#EF4444' : undefined} wrap="truncate-end">
            {line}
          </Text>
        );
      })}
      {lines.length > 40 && <Text dimColor>…（内容过长，已截断）</Text>}
      <Box marginTop={0}>
        <Text color="#06B6D4" bold>[y] 允许  </Text>
        <Text color="#10B981" bold>[a] 本会话全部允许  </Text>
        <Text color="#EF4444" bold>[n] 拒绝  </Text>
        <Text dimColor>（60 秒无响应自动拒绝）</Text>
      </Box>
    </Box>
  );
}

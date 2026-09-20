/** @jsxImportSource react */
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../theme.js';

interface Props {
  /** Full confirmation message (may contain a diff preview). */
  message: string;
  onAnswer: (allowed: boolean, alwaysAllow: boolean) => void;
}

/**
 * v3.0.5: the permission prompt. Rendered INSTEAD of UserInput while a
 * confirmation is pending, so Ink's useInput broadcast can not double-feed
 * keystrokes into the chat box.
 *
 * v3.0.6: styled as an opencode-style dialog — rounded border, accent
 * title, diff lines colored, keybind chips in the footer.
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

  // v3.2.2: 12 lines max (adversarial-audit fix). The dialog renders in
  // the fixed alt-screen frame; 40 lines of diff preview pushed the frame
  // past the viewport and Ink full-cleared (黑屏). Long diffs truncate.
  // 12 + title + truncation + footer + border = the 17 rows app.tsx
  // reserves for this state.
  const MAX_LINES = 12;
  const lines = message.split('\n');

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.warning}
      paddingX={1}
      width="100%"
      marginBottom={0}
    >
      <Text color={theme.warning} bold>◆ 权限确认</Text>
      {lines.slice(0, MAX_LINES).map((line, i) => {
        const isAdd = line.startsWith('+');
        const isDel = line.startsWith('-');
        return (
          <Text key={i} color={isAdd ? theme.success : isDel ? theme.error : theme.text} wrap="truncate-end">
            {line}
          </Text>
        );
      })}
      {lines.length > MAX_LINES && <Text color={theme.textDim}>…（内容过长，已截断 {lines.length - MAX_LINES} 行）</Text>}
      <Box marginTop={0}>
        <Text color={theme.success} bold>[y] 允许</Text>
        <Text color={theme.textFaint}> · </Text>
        <Text color={theme.accent} bold>[a] 本会话全部允许</Text>
        <Text color={theme.textFaint}> · </Text>
        <Text color={theme.error} bold>[n] 拒绝</Text>
        <Text color={theme.textFaint}>（60 秒无响应自动拒绝）</Text>
      </Box>
    </Box>
  );
}

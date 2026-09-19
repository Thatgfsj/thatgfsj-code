/** @jsxImportSource react */
import React, { useState } from 'react';
import { Box, Text, useInput, useApp, useFocus } from 'ink';
import { COMMAND_LIST } from '../hooks/useCommands.js';
import { theme } from '../theme.js';

interface Props {
  onSubmit: (input: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}

/**
 * v3.0.6 (opencode-style input): a rounded-border input field with an
 * accent `❯` prompt, placeholder text when empty, and a dim keybinding
 * hint bar underneath. Command completion still pops up above the box.
 */
export function UserInput({ onSubmit, onCancel, disabled }: Props) {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [selectedCmd, setSelectedCmd] = useState(0);
  const { exit } = useApp();
  useFocus({ autoFocus: true });

  const showCommands = value.startsWith('/') && value.length > 0 && !value.includes(' ');
  const filteredCommands = showCommands
    ? COMMAND_LIST.filter(c => c.name.startsWith(value))
    : [];

  useInput((input, key) => {
    // ESC - cancel/clear (always works, even when disabled)
    if (key.escape) {
      setValue('');
      setSelectedCmd(0);
      setHistoryIdx(-1);
      onCancel();
      return;
    }

    if (disabled) return;

    // Command selector navigation
    if (showCommands && filteredCommands.length > 0) {
      if (key.upArrow) {
        setSelectedCmd(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedCmd(prev => Math.min(filteredCommands.length - 1, prev + 1));
        return;
      }
      if (key.tab || key.return) {
        const selected = filteredCommands[selectedCmd] || filteredCommands[0];
        // Enter on a list item EXECUTES the command directly; Tab writes
        // the name into the input so the user can append args.
        if (key.return) {
          setSelectedCmd(0);
          setValue('');
          setHistory(prev => [...prev, selected.name]);
          setHistoryIdx(-1);
          onSubmit(selected.name);
          return;
        }
        setValue(selected.name + ' ');
        setSelectedCmd(0);
        return;
      }
    }

    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) {
        if (trimmed === 'exit' || trimmed === 'quit') {
          exit();
          return;
        }
        setHistory(prev => [...prev, trimmed]);
        setHistoryIdx(-1);
        onSubmit(trimmed);
        setValue('');
        setSelectedCmd(0);
      }
      return;
    }

    if (key.upArrow && history.length > 0) {
      const newIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(newIdx);
      setValue(history[newIdx]);
      return;
    }

    if (key.downArrow && historyIdx >= 0) {
      const newIdx = historyIdx + 1;
      if (newIdx >= history.length) {
        setHistoryIdx(-1);
        setValue('');
      } else {
        setHistoryIdx(newIdx);
        setValue(history[newIdx]);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setValue(v => v.slice(0, -1));
      setSelectedCmd(0);
      return;
    }

    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setValue(v => v + input);
      setSelectedCmd(0);
    }
  });

  return (
    <Box flexDirection="column" marginBottom={0}>
      {showCommands && filteredCommands.length > 0 && (
        <Box flexDirection="column" paddingLeft={2} marginBottom={0}>
          {filteredCommands.map((cmd, i) => (
            <Box key={cmd.name}>
              <Text color={i === selectedCmd ? theme.accent : theme.textFaint}>
                {i === selectedCmd ? '▸ ' : '  '}
              </Text>
              <Text color={i === selectedCmd ? theme.accent : theme.textDim} bold={i === selectedCmd}>
                {cmd.name}
              </Text>
              <Text color={theme.textFaint}>  {cmd.desc}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box
        borderStyle="round"
        borderColor={disabled ? theme.border : theme.accentDim}
        paddingX={1}
        width="100%"
      >
        <Box>
          <Text color={theme.accent} bold>{disabled ? ' ' : '❯ '}</Text>
          {value ? (
            <Text>{value}</Text>
          ) : (
            !disabled && <Text color={theme.textFaint}>有什么可以帮你？（/ 命令 · exit 退出）</Text>
          )}
          {!disabled && <Text color={theme.accent}>█</Text>}
        </Box>
      </Box>
      <Box paddingLeft={1}>
        <Text color={theme.textFaint}>↑↓ 历史 · /help 命令 · esc 取消 · ctrl+c 退出</Text>
      </Box>
    </Box>
  );
}

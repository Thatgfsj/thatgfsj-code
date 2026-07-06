/** @jsxImportSource react */
import React, { useState } from 'react';
import { Box, Text, useInput, useApp, useFocus } from 'ink';
import { COMMAND_LIST } from '../hooks/useCommands.js';

interface Props {
  onSubmit: (input: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}

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
    <Box flexDirection="column">
      {showCommands && filteredCommands.length > 0 && (
        <Box flexDirection="column" paddingLeft={2} marginBottom={0}>
          {filteredCommands.map((cmd, i) => (
            <Box key={cmd.name}>
              <Text color={i === selectedCmd ? '#06B6D4' : '#64748B'}>
                {i === selectedCmd ? '▸ ' : '  '}
              </Text>
              <Text color={i === selectedCmd ? '#06B6D4' : '#94A3B8'} bold={i === selectedCmd}>
                {cmd.name}
              </Text>
              <Text color="#64748B">  {cmd.desc}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box paddingY={0}>
        <Text color="#06B6D4" bold>{disabled ? '  ' : '❯ '}</Text>
        <Text>{value}</Text>
        {!disabled && <Text color="#06B6D4">█</Text>}
      </Box>
    </Box>
  );
}

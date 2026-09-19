/** @jsxImportSource react */
import React, { useState } from 'react';
import { Box, Text, useInput, useApp, useFocus } from 'ink';
import { COMMAND_LIST } from '../hooks/useCommands.js';
import { theme } from '../theme.js';

interface Props {
  onSubmit: (input: string) => void;
  onCancel: () => void;
  disabled?: boolean;
  /** Second info line, opencode-style: mode · model · thinking. */
  mode?: string;
  provider?: string;
  model?: string;
  thinking?: 'off' | 'low' | 'medium' | 'high';
  width?: number;
  /**
   * v3.0.11: chat mode spans the full terminal width with split hints
   * (opencode session view). Splash mode stays a fixed-width centered
   * block with right-aligned hints.
   */
  fullWidth?: boolean;
  /**
   * v3.2.1: ↑/↓ contract (user-specified). EMPTY input + ↑/↓ drives the
   * conversation pager when handlers are provided (chat view — 翻页看历史),
   * and falls back to input-history recall when they are not (splash).
   * NON-empty input + ↑/↓ moves the caret up/down through the (possibly
   * multiline) text; ←/→ always move the caret.
   */
  onEmptyUp?: () => void;
  onEmptyDown?: () => void;
}

/**
 * v3.0.8 (opencode-style input): a left accent bar instead of a full
 * border, placeholder text when empty, an info line (mode · model ·
 * thinking) under the entry line, and keybinding hints below the box.
 * Command completion still pops up above.
 *
 * v3.2.1: real caret model. The input keeps a cursor index; characters
 * insert at the caret, backspace/delete delete around it, ←/→ move it and
 * ↑/↓ move it vertically through multiline (pasted) text. The block glyph
 * paints AT the caret position instead of always hanging off the end.
 */
export function UserInput({ onSubmit, onCancel, disabled, mode = 'Build', provider, model, thinking = 'off', width, fullWidth, onEmptyUp, onEmptyDown }: Props) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [selectedCmd, setSelectedCmd] = useState(0);
  const { exit } = useApp();
  useFocus({ autoFocus: true });

  const showCommands = value.startsWith('/') && !value.includes('\n') && value.length > 0 && !value.includes(' ');
  const filteredCommands = showCommands
    ? COMMAND_LIST.filter(c => c.name.startsWith(value))
    : [];

  /** Move the caret vertically through multiline text (degenerates to
   * home/end on single-line input). */
  const caretVertical = (dir: -1 | 1) => {
    setCursor(c => {
      const lineStart = value.lastIndexOf('\n', c - 1) + 1;
      const col = c - lineStart;
      if (dir < 0) {
        if (lineStart === 0) return 0; // first line → home
        const prevStart = value.lastIndexOf('\n', lineStart - 2) + 1;
        const prevLen = (lineStart - 1) - prevStart;
        return prevStart + Math.min(col, prevLen);
      }
      const nl = value.indexOf('\n', c);
      if (nl === -1) return value.length; // last line → end
      const nextNl = value.indexOf('\n', nl + 1);
      const nextLen = (nextNl === -1 ? value.length : nextNl) - (nl + 1);
      return (nl + 1) + Math.min(col, nextLen);
    });
  };

  const recallHistory = (dir: -1 | 1) => {
    if (dir < 0) {
      if (history.length === 0) return;
      const newIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(newIdx);
      setValue(history[newIdx]);
      setCursor(history[newIdx].length);
    } else {
      if (historyIdx < 0) return;
      const newIdx = historyIdx + 1;
      if (newIdx >= history.length) {
        setHistoryIdx(-1);
        setValue('');
        setCursor(0);
      } else {
        setHistoryIdx(newIdx);
        setValue(history[newIdx]);
        setCursor(history[newIdx].length);
      }
    }
  };

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed === 'exit' || trimmed === 'quit') {
      exit();
      return;
    }
    setHistory(prev => [...prev, trimmed]);
    setHistoryIdx(-1);
    onSubmit(trimmed);
    setValue('');
    setCursor(0);
    setSelectedCmd(0);
  };

  useInput((input, key) => {
    // ESC - cancel/clear (always works, even when disabled)
    if (key.escape) {
      setValue('');
      setCursor(0);
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
        if (key.return) {
          setSelectedCmd(0);
          setValue('');
          setCursor(0);
          setHistory(prev => [...prev, selected.name]);
          setHistoryIdx(-1);
          onSubmit(selected.name);
          return;
        }
        setValue(selected.name + ' ');
        setCursor(selected.name.length + 1);
        setSelectedCmd(0);
        return;
      }
    }

    if (key.return) {
      submit();
      return;
    }

    // v3.2.1 arrow contract: ↑/↓ page the conversation when the input is
    // EMPTY (chat passes handlers; splash falls back to history recall),
    // and move the caret through the text when it is NOT empty.
    if (key.upArrow) {
      if (value === '') {
        if (onEmptyUp) onEmptyUp();
        else recallHistory(-1);
        return;
      }
      caretVertical(-1);
      return;
    }
    if (key.downArrow) {
      if (value === '') {
        if (onEmptyDown) onEmptyDown();
        else recallHistory(1);
        return;
      }
      caretVertical(1);
      return;
    }

    if (key.leftArrow) {
      setCursor(c => Math.max(0, c - 1));
      setSelectedCmd(0);
      return;
    }
    if (key.rightArrow) {
      setCursor(c => Math.min(value.length, c + 1));
      setSelectedCmd(0);
      return;
    }

    if (key.backspace || key.delete) {
      if (key.delete) {
        // forward delete: remove the char AT the caret
        setValue(v => (cursor < v.length ? v.slice(0, cursor) + v.slice(cursor + 1) : v));
      } else {
        if (cursor > 0) {
          setValue(v => v.slice(0, cursor - 1) + v.slice(cursor));
          setCursor(c => Math.max(0, c - 1));
        }
      }
      setSelectedCmd(0);
      return;
    }

    if (key.ctrl && input === 'c') {
      exit();
      return;
    }
    // v3.2.1: emacs-style line editing — ctrl+a/e home/end, ctrl+u clear.
    if (key.ctrl && input === 'a') {
      setCursor(0);
      return;
    }
    if (key.ctrl && input === 'e') {
      setCursor(value.length);
      return;
    }
    if (key.ctrl && input === 'u') {
      setValue('');
      setCursor(0);
      setSelectedCmd(0);
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      // Insert AT the caret (pasted multiline text keeps its newlines).
      setValue(v => v.slice(0, cursor) + input + v.slice(cursor));
      setCursor(c => c + input.length);
      setSelectedCmd(0);
    }
  });

  const left = value.slice(0, cursor);
  const right = value.slice(cursor);

  return (
    <Box flexDirection="column">
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
        borderLeft
        borderLeftColor={disabled ? theme.border : theme.accent}
        borderStyle="bold"
        paddingLeft={1}
        paddingRight={1}
        flexDirection="column"
        width={fullWidth ? '100%' : (width ?? 64)}
      >
        {value ? (
          <Text>
            {left}
            <Text color={theme.accent} backgroundColor={disabled ? undefined : theme.text}>█</Text>
            {right}
          </Text>
        ) : (
          <Text>
            <Text color={theme.textFaint}>随便问点什么…（"修一下 TODO" / /help 看命令）</Text>
            <Text color={theme.accent}>█</Text>
          </Text>
        )}
        <Box>
          <Text color={theme.info}>{mode}</Text>
          <Text color={theme.textFaint}> · </Text>
          <Text color={theme.textDim}>{model || ''}</Text>
          {provider && <Text color={theme.textFaint}> ({provider})</Text>}
          {thinking !== 'off' && (
            <>
              <Text color={theme.textFaint}> · </Text>
              <Text color={theme.accent}>thinking:{thinking}</Text>
            </>
          )}
        </Box>
      </Box>
      {/* v3.0.11: chat mode spans full width with split hints (opencode);
          splash mode keeps hints right-aligned under the centered box */}
      <Box
        justifyContent={fullWidth ? 'space-between' : 'flex-end'}
        width={fullWidth ? '100%' : (width ?? 64)}
      >
        <Text color={theme.textFaint}>enter 发送 · ↑↓ 翻页/移光标 · ←→ 移光标 · esc 取消</Text>
        <Text color={theme.textFaint}>/help 命令 · /models 模型 · ctrl+c 退出</Text>
      </Box>
    </Box>
  );
}

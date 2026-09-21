/** @jsxImportSource react */
import React, { useState, useEffect } from 'react';
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
  /**
   * v3.2.2: reports the REAL rendered row count (value window + completion
   * popup + chrome) so app.tsx can size the workspace exactly — a guessed
   * reserve let the frame overflow the alt-screen viewport (黑屏).
   */
  onLayoutRows?: (rows: number) => void;
}

/** Rendered value lines cap — long pastes must not blow the frame budget. */
const LINES_CAP = 5;
/** Completion popup entries cap. */
const MAX_COMPLETIONS = 5;

/**
 * v3.2.1: real caret model (block glyph paints AT the caret).
 * v3.2.2 hardening (adversarial-review fixes):
 *  - value+cursor live in ONE state object updated functionally — two
 *    key events in the same stdin chunk previously read a stale `cursor`
 *    closure and typed "dcba" for "abcd";
 *  - caret steps are surrogate-pair aware (emoji no longer split into
 *    lone surrogates and submitted as mojibake);
 *  - pasted CRLF is normalized to \n (Windows clipboard);
 *  - only ~LINES_CAP lines render around the caret (long pastes render a
 *    window, not the whole text).
 */
export function UserInput({ onSubmit, onCancel, disabled, mode = 'Build', provider, model, thinking = 'off', width, fullWidth, onEmptyUp, onEmptyDown, onLayoutRows }: Props) {
  const [input, setInput] = useState({ value: '', cursor: 0 });
  const { value, cursor } = input;
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [selectedCmd, setSelectedCmd] = useState(0);
  const { exit } = useApp();
  useFocus({ autoFocus: true });

  const showCommands = value.startsWith('/') && !value.includes('\n') && value.length > 0 && !value.includes(' ');
  const filteredCommands = showCommands
    ? COMMAND_LIST.filter(c => c.name.startsWith(value))
    : [];
  // Clamp the highlight when the filtered list shrinks below the old index.
  useEffect(() => {
    setSelectedCmd(c => Math.min(c, Math.max(0, filteredCommands.length - 1)));
  }, [filteredCommands.length]);

  /** One code POINT back from i (surrogate pairs move as a unit). */
  const stepBack = (v: string, i: number): number => {
    if (i >= 2) {
      const hi = v.charCodeAt(i - 2);
      const lo = v.charCodeAt(i - 1);
      if (hi >= 0xD800 && hi <= 0xDBFF && lo >= 0xDC00 && lo <= 0xDFFF) return i - 2;
    }
    return Math.max(0, i - 1);
  };
  /** One code POINT forward from i. */
  const stepFwd = (v: string, i: number): number => {
    if (i < v.length - 1) {
      const hi = v.charCodeAt(i);
      const lo = v.charCodeAt(i + 1);
      if (hi >= 0xD800 && hi <= 0xDBFF && lo >= 0xDC00 && lo <= 0xDFFF) return i + 2;
    }
    return Math.min(v.length, i + 1);
  };

  const lines = value.split('\n');
  let lineStart = 0;
  let cursorLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const nextStart = lineStart + lines[i].length + 1;
    if (cursor < nextStart) { cursorLine = i; break; }
    lineStart = nextStart;
    cursorLine = i;
  }
  // Render a window of at most LINES_CAP lines around the caret line.
  const winStart = Math.max(0, Math.min(cursorLine - 2, lines.length - LINES_CAP));
  const winLines = lines.slice(winStart, winStart + LINES_CAP);
  const hiddenTop = winStart;
  const hiddenBottom = lines.length - (winStart + winLines.length);

  // v3.2.2: exact row accounting for the app's bottom reserve.
  const completionRows = filteredCommands.length > 0
    ? Math.min(filteredCommands.length, MAX_COMPLETIONS) + (filteredCommands.length > MAX_COMPLETIONS ? 1 : 0)
    : 0;
  const layoutRows = 3 /* box borders + info line */ + 1 /* hints */ + winLines.length
    + (hiddenTop > 0 ? 1 : 0) + (hiddenBottom > 0 ? 1 : 0) + completionRows;
  useEffect(() => {
    onLayoutRows?.(layoutRows);
  }, [layoutRows, onLayoutRows]);

  /** Move the caret vertically through multiline text (degenerates to
   * home/end on single-line input). */
  const caretVertical = (dir: -1 | 1) => {
    setInput(s => {
      const v = s.value;
      const c = s.cursor;
      const ls = v.lastIndexOf('\n', c - 1) + 1;
      const col = c - ls;
      if (dir < 0) {
        if (ls === 0) return { ...s, cursor: 0 }; // first line → home
        const prevStart = v.lastIndexOf('\n', ls - 2) + 1;
        const prevLen = (ls - 1) - prevStart;
        return { ...s, cursor: prevStart + Math.min(col, prevLen) };
      }
      const nl = v.indexOf('\n', c);
      if (nl === -1) return { ...s, cursor: v.length }; // last line → end
      const nextNl = v.indexOf('\n', nl + 1);
      const nextLen = (nextNl === -1 ? v.length : nextNl) - (nl + 1);
      return { ...s, cursor: (nl + 1) + Math.min(col, nextLen) };
    });
  };

  const recallHistory = (dir: -1 | 1) => {
    if (dir < 0) {
      if (history.length === 0) return;
      const newIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(newIdx);
      setInput({ value: history[newIdx], cursor: history[newIdx].length });
    } else {
      if (historyIdx < 0) return;
      const newIdx = historyIdx + 1;
      if (newIdx >= history.length) {
        setHistoryIdx(-1);
        setInput({ value: '', cursor: 0 });
      } else {
        setHistoryIdx(newIdx);
        setInput({ value: history[newIdx], cursor: history[newIdx].length });
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
    setInput({ value: '', cursor: 0 });
    setSelectedCmd(0);
  };

  useInput((rawInput, key) => {
    // ESC - v3.2.2 split semantics: typed text (or completion state) is
    // cleared WITHOUT calling onCancel — clearing must not abort a running
    // turn or drop a queued message. Empty input esc = cancel/exit-pager.
    if (key.escape) {
      if (value !== '') {
        setInput({ value: '', cursor: 0 });
        setSelectedCmd(0);
        setHistoryIdx(-1);
        return;
      }
      setInput({ value: '', cursor: 0 });
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
          setInput({ value: '', cursor: 0 });
          setHistory(prev => [...prev, selected.name]);
          setHistoryIdx(-1);
          onSubmit(selected.name);
          return;
        }
        setInput({ value: selected.name + ' ', cursor: selected.name.length + 1 });
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
      setInput(s => ({ ...s, cursor: stepBack(s.value, s.cursor) }));
      setSelectedCmd(0);
      return;
    }
    if (key.rightArrow) {
      setInput(s => ({ ...s, cursor: stepFwd(s.value, s.cursor) }));
      setSelectedCmd(0);
      return;
    }

    if (key.backspace || key.delete) {
      if (key.delete) {
        // forward delete: remove the code point AT the caret
        setInput(s => {
          if (s.cursor >= s.value.length) return s;
          const fwd = stepFwd(s.value, s.cursor);
          return { value: s.value.slice(0, s.cursor) + s.value.slice(fwd), cursor: s.cursor };
        });
      } else {
        setInput(s => {
          if (s.cursor === 0) return s;
          const back = stepBack(s.value, s.cursor);
          return { value: s.value.slice(0, back) + s.value.slice(s.cursor), cursor: back };
        });
      }
      setSelectedCmd(0);
      return;
    }

    if (key.ctrl && rawInput === 'c') {
      exit();
      return;
    }
    // v3.2.1: emacs-style line editing — ctrl+a/e home/end, ctrl+u clear.
    if (key.ctrl && rawInput === 'a') {
      setInput(s => ({ ...s, cursor: 0 }));
      return;
    }
    if (key.ctrl && rawInput === 'e') {
      setInput(s => ({ ...s, cursor: s.value.length }));
      return;
    }
    if (key.ctrl && rawInput === 'u') {
      setInput({ value: '', cursor: 0 });
      setSelectedCmd(0);
      return;
    }

    if (rawInput && !key.ctrl && !key.meta) {
      // Insert AT the caret (v3.2.2: CRLF pastes normalize to \n; the
      // functional update uses the LATEST state so same-chunk multi-key
      // events can no longer interleave through a stale cursor).
      const text = rawInput.replace(/\r\n?/g, '\n');
      setInput(s => ({
        value: s.value.slice(0, s.cursor) + text + s.value.slice(s.cursor),
        cursor: s.cursor + text.length,
      }));
      setSelectedCmd(0);
    }
  });

  const cursorLineStart = lineStart;
  const col = cursor - cursorLineStart;
  const cursorLineIdx = cursorLine - winStart;

  return (
    <Box flexDirection="column">
      {showCommands && filteredCommands.length > 0 && (
        <Box flexDirection="column" paddingLeft={2} marginBottom={0}>
          {filteredCommands.slice(0, MAX_COMPLETIONS).map((cmd, i) => (
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
          {filteredCommands.length > MAX_COMPLETIONS && (
            <Text color={theme.textFaint}>  …还有 {filteredCommands.length - MAX_COMPLETIONS} 个，继续输入筛选</Text>
          )}
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
          <>
            {hiddenTop > 0 && <Text color={theme.textFaint}>…（共 {lines.length} 行）</Text>}
            {winLines.map((line, i) => {
              if (i !== cursorLineIdx) return <Text key={i}>{line}</Text>;
              const left = line.slice(0, col);
              const right = line.slice(col);
              return (
                <Text key={i}>
                  {left}
                  <Text color={theme.accent} backgroundColor={disabled ? undefined : theme.text}>█</Text>
                  {right}
                </Text>
              );
            })}
            {hiddenBottom > 0 && <Text color={theme.textFaint}>…（还有 {hiddenBottom} 行）</Text>}
          </>
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
          splash mode stacks the hints under the centered box — the fixed
          64-col width used to wrap the two lines into each other. */}
      {fullWidth ? (
        <Box justifyContent="space-between" width="100%">
          <Text color={theme.textFaint}>enter 发送 · ↑↓ 历史/移光标 · ←→ 移光标 · esc 取消</Text>
          <Text color={theme.textFaint}>/help 命令 · /models 模型 · ctrl+c 退出</Text>
        </Box>
      ) : (
        <Box flexDirection="column" alignItems="flex-end" width={width ?? 64}>
          <Text color={theme.textFaint}>enter 发送 · ↑↓ 历史 · esc 取消</Text>
          <Text color={theme.textFaint}>/help 命令 · /models 模型 · ctrl+c 退出</Text>
        </Box>
      )}
    </Box>
  );
}

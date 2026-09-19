/** @jsxImportSource react */
import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { App } from '../../app/index.js';
import { theme } from '../theme.js';

type Submode = null | { type: 'add' | 'context' | 'window'; value: string; error?: string };

interface Props {
  app: App;
  onClose: () => void;
  width?: number;
}

/**
 * v3.0.8: the model settings dialog (opencode-style), opened with
 * /models. Manages the model list and per-model settings:
 *
 *   ↑/↓  选择模型        a  添加模型
 *   t    思考强度循环     c  上下文长度
 *   d    删除自定义模型    esc 关闭
 *
 * Settings persist to config.json (modelSettings / customModels) and the
 * current model's context length applies to the live session immediately.
 */
export function ModelSettings({ app, onClose, width }: Props) {
  const [models, setModels] = useState<string[]>(() => app.listConfiguredModels());
  const [selected, setSelected] = useState(0);
  const [submode, setSubmode] = useState<Submode>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, forceRender] = useState(0);
  const rerender = () => forceRender(n => n + 1);

  // Repaint when config changes underneath us (setModelThinking etc.).
  useEffect(() => {
    setModels(app.listConfiguredModels());
  }, [toast, submode, app]);

  const currentModel = app.config.get().model;
  const settings = app.config.get().modelSettings || {};
  const idx = Math.min(selected, models.length - 1);
  const active = models[idx];

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const commitSubmode = async () => {
    if (!submode) return;
    if (submode.type === 'add') {
      const id = submode.value.trim();
      if (!id) { setSubmode(null); return; }
      if (models.includes(id)) {
        setSubmode({ ...submode, error: '该模型已存在' });
        return;
      }
      await app.addCustomModel(id);
      setModels(app.listConfiguredModels());
      setSubmode(null);
      flash(`已添加模型 ${id}`);
    } else if (submode.type === 'context') {
      const n = parseInt(submode.value, 10);
      if (!Number.isFinite(n) || n < 5 || n > 1000) {
        setSubmode({ ...submode, error: '请输入 5-1000 的数字' });
        return;
      }
      await app.setModelContextLength(active, n);
      setSubmode(null);
      flash(`${active} 上下文长度 → ${n}`);
    } else if (submode.type === 'window') {
      const n = parseInt(submode.value, 10);
      if (!Number.isFinite(n) || n < 1000 || n > 10000000) {
        setSubmode({ ...submode, error: '请输入 1,000-10,000,000 的 token 数' });
        return;
      }
      await app.setModelContextWindow(active, n);
      setSubmode(null);
      flash(`${active} 上下文窗口 → ${n} tokens（85% 时自动压缩）`);
    }
  };

  const cycleThinking = async () => {
    const order: Array<'off' | 'low' | 'medium' | 'high'> = ['off', 'low', 'medium', 'high'];
    const now = app.getThinking(active);
    const next = order[(order.indexOf(now) + 1) % order.length];
    await app.setModelThinking(active, next);
    rerender();
    flash(next === 'off' ? `${active} 思考关闭` : `${active} 思考强度 → ${next}`);
  };

  const deleteSelected = async () => {
    if (active === currentModel) {
      flash('当前使用中的模型不能删除');
      return;
    }
    if (!(app.config.get().customModels || []).includes(active)) {
      flash('只有自定义添加的模型可以删除');
      return;
    }
    await app.removeCustomModel(active);
    setModels(app.listConfiguredModels());
    setSelected(0);
    flash(`已删除 ${active}`);
  };

  useInput((input, key) => {
    if (submode) {
      if (key.escape) { setSubmode(null); return; }
      if (key.return) { void commitSubmode(); return; }
      if (key.backspace || key.delete) {
        setSubmode(s => (s ? { ...s, value: s.value.slice(0, -1), error: undefined } : s));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setSubmode(s => (s ? { ...s, value: s.value + input, error: undefined } : s));
      }
      return;
    }

    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setSelected(i => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setSelected(i => Math.min(models.length - 1, i + 1)); return; }

    if (input === 'a' || input === 'A') {
      setSubmode({ type: 'add', value: '' });
      return;
    }
    if (input === 'c' || input === 'C') {
      const cur = settings[active]?.contextLength ?? app.session.getMaxMessages();
      setSubmode({ type: 'context', value: String(cur) });
      return;
    }
    if (input === 'w' || input === 'W') {
      setSubmode({ type: 'window', value: String(app.getContextWindow(active)) });
      return;
    }
    if (input === 't' || input === 'T') {
      void cycleThinking();
      return;
    }
    if (input === 'd' || input === 'D') {
      void deleteSelected();
      return;
    }
  });

  const dialogWidth = Math.min(width || 80, 72);
  const THINKING_LABEL: Record<string, string> = { off: 'off', low: 'low', medium: 'medium', high: 'high' };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      width={dialogWidth}
    >
      <Box justifyContent="space-between">
        <Text color={theme.accent} bold>◆ 模型设置</Text>
        <Text color={theme.textFaint}>esc 关闭</Text>
      </Box>
      <Text color={theme.border}>{'─'.repeat(Math.max(10, dialogWidth - 2))}</Text>

      <Text color={theme.textDim}>模型列表</Text>
      {models.map((m, i) => {
        const st = settings[m] || {};
        const isSel = i === idx;
        const isCurrent = m === currentModel;
        const thinking = st.thinking ?? 'off';
        return (
          <Box key={m}>
            <Text color={isSel ? theme.accent : theme.textFaint}>{isSel ? '▸ ' : '  '}</Text>
            <Text color={isSel ? theme.text : theme.textDim} bold={isSel} wrap="truncate-end">
              {m.slice(0, dialogWidth - 34)}
            </Text>
            <Text color={theme.textFaint}>  ctx {st.contextLength ?? app.session.getMaxMessages()}</Text>
            <Text color={theme.textFaint}> · 窗口 {(app.getContextWindow(m) / 1000).toFixed(0)}k</Text>
            <Text color={thinking !== 'off' ? theme.accent : theme.textFaint}>
              {'  '}thinking {THINKING_LABEL[thinking]}
            </Text>
            {isCurrent && <Text color={theme.success}>  ● 当前</Text>}
          </Box>
        );
      })}

      <Text color={theme.border}>{'─'.repeat(Math.max(10, dialogWidth - 2))}</Text>

      {submode ? (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.accent}>
              {submode.type === 'add' ? '添加模型 id ❯ '
                : submode.type === 'window' ? `${active} 上下文窗口(tokens) ❯ `
                : `${active} 上下文长度 ❯ `}
            </Text>
            <Text>{submode.value}</Text>
            <Text color={theme.text}>█</Text>
          </Box>
          {submode.error && <Text color={theme.error}>{submode.error}</Text>}
          <Text color={theme.textFaint}>enter 确认 · esc 取消</Text>
        </Box>
      ) : (
        <Box>
          <Text color={theme.textFaint}>↑↓ 选择 · </Text>
          <Text color={theme.accent}>a</Text>
          <Text color={theme.textFaint}> 添加模型 · </Text>
          <Text color={theme.accent}>c</Text>
          <Text color={theme.textFaint}> 上下文长度 · </Text>
          <Text color={theme.accent}>w</Text>
          <Text color={theme.textFaint}> 上下文窗口(tokens) · </Text>
          <Text color={theme.accent}>t</Text>
          <Text color={theme.textFaint}> 思考强度 · </Text>
          <Text color={theme.accent}>d</Text>
          <Text color={theme.textFaint}> 删除自定义</Text>
        </Box>
      )}
      {toast && <Text color={theme.success}>✓ {toast}</Text>}
    </Box>
  );
}

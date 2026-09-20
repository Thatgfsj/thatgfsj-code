/** @jsxImportSource react */
import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import stringWidth from 'string-width';
import type { App } from '../../app/index.js';
import { theme } from '../theme.js';

type Submode = null | { type: 'add' | 'context' | 'window'; value: string; error?: string };

interface Props {
  app: App;
  onClose: () => void;
  width?: number;
}

/**
 * v3.0.15: the model settings dialog (opencode-style), opened with /models.
 * Renders as a fixed-width, rounded-border modal that the app centers in the
 * terminal (see TuiApp's model_settings branch, mirroring opencode's
 * ui/dialog.tsx full-screen + alignItems:center container).
 *
 * Layout rules learned from opencode's dialog-select.tsx:
 *   - header row: bold title left, muted "esc" right (space-between)
 *   - every line is pre-truncated to the dialog content width
 *     (dialogWidth - border 2 - paddingX 2) so nothing ever wraps
 *   - footer key hints use the "key + dim description" pattern, split over
 *     two compact rows instead of one over-long line
 *
 * Keys:
 *   ↑/↓ 选择   a 添加模型   c 上下文长度(5-1000)   w 上下文窗口
 *   t 思考强度循环(off/low/medium/high)   d 删除自定义模型   esc 关闭
 *
 * Settings persist to config.json (modelSettings / customModels) and the
 * current model's context length applies to the live session immediately.
 */

/** CJK-aware truncation: never exceed `max` display columns. */
function truncateToWidth(s: string, max: number): string {
  if (max <= 0) return '';
  if (stringWidth(s) <= max) return s;
  let out = '';
  for (const ch of s) {
    if (stringWidth(out + ch) > max - 1) return out + '…';
    out += ch;
  }
  return out;
}

/** opencode FooterAction pattern: accent key + dim description. */
function KeyHint({ keys, desc, last = false }: { keys: string; desc: string; last?: boolean }) {
  return (
    <>
      <Text color={theme.accent}>{keys}</Text>
      <Text color={theme.textDim}> {desc}</Text>
      {!last && <Text color={theme.textFaint}> · </Text>}
    </>
  );
}

export function ModelSettings({ app, onClose, width }: Props) {
  const [models, setModels] = useState<string[]>(() => app.listConfiguredModels());
  // v3.0.20: selection starts ON the current model.
  const [selected, setSelected] = useState(() => {
    const list = app.listConfiguredModels();
    const i = list.indexOf(app.config.get().model);
    return i >= 0 ? i : 0;
  });
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
  const idx = Math.min(Math.max(selected, 0), Math.max(0, models.length - 1));
  const active = models[idx];

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  /** Loose identity: case + separators insensitive (glm5.3 vs glm-5.3). */
  const normId = (s: string) => s.toLowerCase().replace(/[-_.\s]/g, '');

  /** v3.0.20: make the highlighted model the active one (enter). */
  const switchTo = async (target: string) => {
    if (!target) return;
    if (target === currentModel) {
      flash(`${target} 已是当前模型`);
      return;
    }
    // v3.4.2: through App.switchModel — records provider-tagged history
    // and hot-reloads; the direct config.save skipped both.
    await app.switchModel(target);
    rerender();
    flash(`已切换使用 ${target}`);
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
      // v3.0.20: near-duplicate guard (glm5.3-flash vs glm-5.3-flash).
      const twin = models.find(m => m !== id && normId(m) === normId(id));
      if (twin) {
        setSubmode({ ...submode, error: `与已有模型 ${twin} 高度相似，疑似重复。仍要添加请换个名字` });
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

    // v3.0.20: enter switches the highlighted model to be the active one.
    if (key.return) { void switchTo(active); return; }

    if (input === 'a' || input === 'A') {
      setSubmode({ type: 'add', value: '' });
      return;
    }
    // v3.0.20 key map (user spec): a=添加 b=上下文长度 c=思考强度 w=窗口 d=删除
    if (input === 'b' || input === 'B') {
      const cur = settings[active]?.contextLength ?? app.session.getMaxMessages();
      setSubmode({ type: 'context', value: String(cur) });
      return;
    }
    if (input === 'c' || input === 'C') {
      void cycleThinking();
      return;
    }
    if (input === 'w' || input === 'W') {
      setSubmode({ type: 'window', value: String(app.getContextWindow(active)) });
      return;
    }
    if (input === 'd' || input === 'D') {
      void deleteSelected();
      return;
    }
  });

  // Dialog geometry. Content width = dialogWidth - border(2) - paddingX(2).
  // Every rendered line is pre-truncated to this budget so the frame never
  // wraps (the v3.0.14 separator/keys overflow bug). Rules take 2 extra
  // columns of margin — an exactly-full-width Text can still wrap at the
  // terminal's deferred-EOL column (v3.0.16 user report: rule broke into
  // "── ──").
  const dialogWidth = Math.max(24, Math.min(width || 72, 72));
  const contentW = dialogWidth - 4;
  const rule = '─'.repeat(Math.max(4, contentW - 2));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1} width={dialogWidth}>
      {/* header: bold title left, muted dismiss right (opencode header row) */}
      <Box justifyContent="space-between" width={contentW}>
        <Text color={theme.accent} bold>◆ 模型设置</Text>
        <Text color={theme.textFaint}>esc 关闭</Text>
      </Box>
      <Text color={theme.border} wrap="truncate-end">{truncateToWidth(rule, contentW)}</Text>

      {models.map((m, i) => {
        const st = settings[m] || {};
        const isSel = i === idx;
        const isCurrent = m === currentModel;
        const thinking = st.thinking ?? 'off';
        // chips render right of the id; the id shrinks (with …) so the
        // whole row always fits in one line.
        const chipsFull =
          `ctx ${st.contextLength ?? app.session.getMaxMessages()}` +
          ` · 窗口 ${(app.getContextWindow(m) / 1000).toFixed(0)}k` +
          ` · thinking ${thinking}` +
          (isCurrent ? ' · ● 当前' : '');
        let chips = chipsFull;
        let maxIdW = contentW - 2 - 2 - stringWidth(chips); // prefix '▸ ' + gap '  '
        if (maxIdW < 4) {
          // pathological narrow dialog: keep a minimal id, truncate chips too
          maxIdW = 4;
          chips = truncateToWidth(chipsFull, Math.max(1, contentW - 4 - maxIdW));
        }
        const id = truncateToWidth(m, maxIdW);
        return (
          <Box key={m}>
            <Text color={isSel ? theme.accent : theme.textFaint}>{isSel ? '▸ ' : '  '}</Text>
            <Text color={isSel ? theme.text : theme.textDim} bold={isSel} wrap="truncate-end">{id}</Text>
            <Text color={theme.textFaint}>{'  '}{chips}</Text>
          </Box>
        );
      })}

      <Text color={theme.border} wrap="truncate-end">{truncateToWidth(rule, contentW)}</Text>

      {submode ? (
        <Box flexDirection="column" width={contentW}>
          {(() => {
            const label =
              submode.type === 'add' ? '添加模型 id ❯ '
                : submode.type === 'window' ? `${truncateToWidth(active, 24)} 上下文窗口(tokens) ❯ `
                : `${truncateToWidth(active, 24)} 上下文长度 ❯ `;
            const budget = contentW - stringWidth(submode.value) - 1; // 1 = cursor █
            return (
              <Box>
                <Text color={theme.accent}>{truncateToWidth(label, Math.max(4, budget))}</Text>
                <Text color={theme.text}>{truncateToWidth(submode.value, Math.max(0, contentW - 1))}</Text>
                <Text color={theme.text}>█</Text>
              </Box>
            );
          })()}
          {submode.error && <Text color={theme.error} wrap="truncate-end">{truncateToWidth(submode.error, contentW)}</Text>}
          <Box>
            <KeyHint keys="enter" desc="确认" />
            <KeyHint keys="esc" desc="取消" last />
          </Box>
        </Box>
      ) : (
        // two-line compact key table: accent keys, dim descriptions.
        // v3.0.20 key map (user spec): enter=切换 a=添加 b=上下文长度
        // c=思考强度 w=上下文窗口 d=删除 esc=关闭
        <Box flexDirection="column" width={contentW}>
          <Box>
            <KeyHint keys="↑↓" desc="选择" />
            <KeyHint keys="enter" desc="切换使用" />
            <KeyHint keys="a" desc="添加模型" />
            <KeyHint keys="d" desc="删除" />
            <KeyHint keys="esc" desc="关闭" last />
          </Box>
          <Box>
            <KeyHint keys="b" desc="上下文长度" />
            <KeyHint keys="w" desc="上下文窗口" />
            <KeyHint keys="c" desc="思考强度" last />
          </Box>
        </Box>
      )}
      {toast && <Text color={theme.success} wrap="truncate-end">{truncateToWidth(`✓ ${toast}`, contentW)}</Text>}
    </Box>
  );
}

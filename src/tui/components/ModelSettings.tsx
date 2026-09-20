/** @jsxImportSource react */
import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import stringWidth from 'string-width';
import type { App } from '../../app/index.js';
import { PROVIDERS, MODEL_CATALOGS, getApiKeyFromEnv, listProviders } from '../../config/providers.js';
import { BUILTIN_MODEL_ID } from '../../config/builtin.js';
import { historyForProvider } from '../../config/modelHistory.js';
import type { ProviderName } from '../../config/types.js';
import { theme } from '../theme.js';

type Submode = null | {
  type: 'add' | 'context' | 'window' | 'key';
  value: string;
  error?: string;
  /** key submode: which provider/model the key is for */
  provider?: ProviderName;
  model?: string;
};

interface Props {
  app: App;
  onClose: () => void;
  width?: number;
  /** v3.4.4: max model rows rendered — the dialog must never outgrow the
   *  alt-screen viewport (frame overflow = Ink full-clear = black flash). */
  maxRows?: number;
}

/**
 * v3.4.4: THE single model/provider dialog. /model, /服务商 and /models all
 * open it. One list contains every provider's catalog plus the builtin
 * shared model and the user's custom ids; selecting a foreign model that we
 * hold no key for asks for the key INLINE (the separate full-screen wizard
 * is gone). k sets/updates the current provider's key without switching.
 *
 * Keys:
 *   ↑/↓ 选择   enter 切换（跨服务商自动带 provider+key）
 *   a 添加模型  d 删除自定义  b 上下文长度  w 上下文窗口  c 思考强度
 *   k 当前服务商 API Key   esc 关闭
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

interface Entry {
  key: string;
  /** section separator rows are rendered dim and never activate */
  sep?: string;
  id?: string;
  provider?: ProviderName;
  label?: string;
  builtin?: boolean;
  custom?: boolean;
  current?: boolean;
}

function buildEntries(app: App): Entry[] {  const c = app.config.get();
  const cur: ProviderName = c.provider;
  const entries: Entry[] = [];
  let n = 0;
  const nextKey = () => `e${n++}`;

  entries.push({ key: nextKey(), sep: `── ${PROVIDERS[cur]?.name || cur} ──` });
  // current model first
  entries.push({ key: nextKey(), id: c.model, provider: cur, current: true, label: `${c.model} ● 当前` });
  const seen = new Set<string>([c.model]);
  const push = (id: string, provider: ProviderName, opts?: { custom?: boolean; builtin?: boolean }) => {
    if (!id || seen.has(`${provider}::${id}`)) return;
    seen.add(`${provider}::${id}`);
    entries.push({
      key: nextKey(),
      id,
      provider,
      custom: opts?.custom,
      builtin: opts?.builtin,
      label: provider === cur ? id : `${PROVIDERS[provider]?.name || provider} · ${id}`,
    });
  };

  for (const m of c.customModels || []) push(m, cur, { custom: true });
  for (const e of historyForProvider(cur)) push(e.id, cur);
  for (const m of MODEL_CATALOGS[cur] || []) push(m.id, cur);

  entries.push({ key: nextKey(), sep: '── 内置共享 ──' });
  entries.push({ key: nextKey(), id: BUILTIN_MODEL_ID, provider: 'siliconflow', builtin: true, label: `${BUILTIN_MODEL_ID} · 内置共享（无需 Key）` });

  entries.push({ key: nextKey(), sep: '── 其他服务商 ──' });
  for (const p of listProviders()) {
    if (p.key === cur) continue;
    for (const m of MODEL_CATALOGS[p.key]) push(m.id, p.key);
  }
  return entries;
}

/** What activating an entry should do (pure — unit-testable). */
export function resolveActivation(
  cfg: { provider: ProviderName; apiKeys?: Record<string, string> },
  envHasKey: boolean,
  e: Entry,
): 'builtin' | 'same-provider' | 'switch-ready' | 'need-key' | 'noop' {
  if (e.sep || !e.id || !e.provider) return 'noop';
  if (e.builtin) return 'builtin';
  if (e.provider === cfg.provider) return 'same-provider';
  const pc = PROVIDERS[e.provider];
  if (pc?.keyless || envHasKey || !!cfg.apiKeys?.[e.provider]) return 'switch-ready';
  return 'need-key';
}

export function ModelSettings({ app, onClose, width, maxRows = 12 }: Props) {
  const [, forceRender] = useState(0);
  const rerender = () => forceRender(n => n + 1);
  const [entries, setEntries] = useState<Entry[]>(() => buildEntries(app));
  const [selected, setSelected] = useState(1); // first real entry under the current-provider header
  const [submode, setSubmode] = useState<Submode>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = () => {
    const next = buildEntries(app);
    setEntries(next);
    return next;
  };

  useEffect(() => {
    setEntries(buildEntries(app));
  }, [toast, submode, app]);

  const currentModel = app.config.get().model;

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => { setToast(null); rerender(); }, 3000);
  };

  /** Loose identity: case + separators insensitive (glm5.3 vs glm-5.3). */
  const normId = (s: string) => s.toLowerCase().replace(/[-_.\s]/g, '');

  const idx = Math.min(Math.max(selected, 0), Math.max(0, entries.length - 1));
  const active = entries[idx];

  const switchTo = async (target: string) => {
    if (!target) return;
    if (target === currentModel) { flash(`${target} 已是当前模型`); return; }
    await app.switchModel(target);
    flash(`已切换使用 ${target}`);
  };

  /** Selecting any entry: same provider → plain switch; foreign → provider
   *  + key together, asking for the key inline when we don't hold one. */
  const activate = async (e: Entry) => {
    if (e.sep || !e.id || !e.provider) return;
    const c = app.config.get();
    const kind = resolveActivation(c, !!getApiKeyFromEnv(e.provider), e);
    if (kind === 'builtin') {
      await app.switchModel(BUILTIN_MODEL_ID, { provider: 'siliconflow', useBuiltin: true });
      flash('已切换到内置共享模型（无需 Key）');
      rerender();
      return;
    }
    if (kind === 'same-provider') {
      await switchTo(e.id);
      rerender();
      return;
    }
    if (kind === 'switch-ready') {
      const pc = PROVIDERS[e.provider];
      await app.switchModel(e.id, { provider: e.provider });
      flash(`已切换: ${pc?.name || e.provider} / ${e.id}`);
      rerender();
    } else if (kind === 'need-key') {
      setSubmode({ type: 'key', value: '', provider: e.provider, model: e.id });
    }
  };

  const commitSubmode = async () => {
    if (!submode) return;
    if (submode.type === 'add') {
      const id = submode.value.trim();
      if (!id) { setSubmode(null); return; }
      const models = app.listConfiguredModels();
      if (models.includes(id)) {
        setSubmode({ ...submode, error: '该模型已存在' });
        return;
      }
      const twin = models.find(m => m !== id && normId(m) === normId(id));
      if (twin) {
        setSubmode({ ...submode, error: `与已有模型 ${twin} 高度相似，疑似重复。仍要添加请换个名字` });
        return;
      }
      await app.addCustomModel(id);
      refresh();
      setSubmode(null);
      flash(`已添加模型 ${id}`);
    } else if (submode.type === 'key') {
      const key = submode.value.trim();
      if (!key) { setSubmode({ ...submode, error: 'Key 不能为空' }); return; }
      await app.switchModel(submode.model || app.config.get().model, {
        provider: submode.provider,
        apiKey: key,
      });
      refresh();
      setSubmode(null);
      flash(`已保存 ${PROVIDERS[submode.provider!]?.name || submode.provider} 的 Key 并切换`);
      rerender();
    } else if (submode.type === 'context') {
      const tgt = active?.id || currentModel;
      const nv = parseInt(submode.value, 10);
      if (!Number.isFinite(nv) || nv < 5 || nv > 1000) {
        setSubmode({ ...submode, error: '请输入 5-1000 的数字' });
        return;
      }
      await app.setModelContextLength(tgt, nv);
      setSubmode(null);
      flash(`${tgt} 上下文长度 → ${nv}`);
    } else if (submode.type === 'window') {
      const tgt = active?.id || currentModel;
      const nv = parseInt(submode.value, 10);
      if (!Number.isFinite(nv) || nv < 1000 || nv > 10000000) {
        setSubmode({ ...submode, error: '请输入 1,000-10,000,000 的 token 数' });
        return;
      }
      await app.setModelContextWindow(tgt, nv);
      setSubmode(null);
      flash(`${tgt} 上下文窗口 → ${nv} tokens（85% 时自动压缩）`);
    }
  };

  const cycleThinking = async () => {
    const tgt = active?.id || currentModel;
    const order: Array<'off' | 'low' | 'medium' | 'high'> = ['off', 'low', 'medium', 'high'];
    const now = app.getThinking(tgt);
    const next = order[(order.indexOf(now) + 1) % order.length];
    await app.setModelThinking(tgt, next);
    rerender();
    flash(next === 'off' ? `${tgt} 思考关闭` : `${tgt} 思考强度 → ${next}`);
  };

  const deleteSelected = async () => {
    const id = active?.id;
    if (!id) return;
    if (id === currentModel) { flash('当前使用中的模型不能删除'); return; }
    if (!(app.config.get().customModels || []).includes(id)) {
      flash('只有自定义添加的模型可以删除');
      return;
    }
    await app.removeCustomModel(id);
    refresh();
    setSelected(0);
    flash(`已删除 ${id}`);
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
    if (key.downArrow) { setSelected(i => Math.min(entries.length - 1, i + 1)); return; }

    if (key.return) { void activate(active); return; }

    if (input === 'a' || input === 'A') { setSubmode({ type: 'add', value: '' }); return; }
    if (input === 'b' || input === 'B') {
      const id = active?.id || currentModel;
      const cur = app.config.get().modelSettings?.[id]?.contextLength ?? app.session.getMaxMessages();
      setSubmode({ type: 'context', value: String(cur) });
      return;
    }
    if (input === 'c' || input === 'C') { void cycleThinking(); return; }
    if (input === 'w' || input === 'W') {
      const id = active?.id || currentModel;
      setSubmode({ type: 'window', value: String(app.getContextWindow(id)) });
      return;
    }
    if (input === 'd' || input === 'D') { void deleteSelected(); return; }
    if (input === 'k' || input === 'K') {
      const c = app.config.get();
      setSubmode({ type: 'key', value: '', provider: c.provider, model: c.model });
      return;
    }
  });

  // viewport over the entry list so the dialog never outgrows the terminal
  const viewRows = Math.max(4, maxRows);
  let start = 0;
  if (entries.length > viewRows) {
    start = Math.min(Math.max(0, idx - Math.floor(viewRows / 2)), entries.length - viewRows);
  }
  const visible = entries.slice(start, start + viewRows);
  const settings = app.config.get().modelSettings || {};

  // Dialog geometry. Content width = dialogWidth - border(2) - paddingX(2).
  const dialogWidth = Math.max(30, Math.min(width || 72, 72));
  const contentW = dialogWidth - 4;
  const rule = '─'.repeat(Math.max(4, contentW - 2));

  const submodeLabel =
    submode?.type === 'add' ? '添加模型 id ❯ '
      : submode?.type === 'key' ? `输入 ${PROVIDERS[submode.provider!]?.name || submode.provider} 的 API Key ❯ `
        : submode?.type === 'window' ? `${truncateToWidth(active?.id || currentModel, 24)} 上下文窗口(tokens) ❯ `
          : `${truncateToWidth(active?.id || currentModel, 24)} 上下文长度 ❯ `;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1} width={dialogWidth}>
      <Box justifyContent="space-between" width={contentW}>
        <Text color={theme.accent} bold>◆ 模型设置</Text>
        <Text color={theme.textFaint}>esc 关闭</Text>
      </Box>
      <Text color={theme.border} wrap="truncate-end">{truncateToWidth(rule, contentW)}</Text>

      {visible.map((e) => {
        if (e.sep) {
          return <Text key={e.key} color={theme.textFaint} wrap="truncate-end">{truncateToWidth(e.sep, contentW)}</Text>;
        }
        const isSel = e.key === active?.key;
        const id = e.id!;
        const st = settings[id] || {};
        const thinking = st.thinking ?? 'off';
        const hasKey = e.builtin
          || PROVIDERS[e.provider!]?.keyless
          || !!getApiKeyFromEnv(e.provider!)
          || !!app.config.get().apiKeys?.[e.provider!];
        const chips =
          (e.current || id === currentModel ? '● 当前 · ' : '') +
          `ctx ${st.contextLength ?? app.session.getMaxMessages()}` +
          ` · 窗口 ${(app.getContextWindow(id) / 1000).toFixed(0)}k` +
          ` · thinking ${thinking}` +
          (hasKey ? '' : ' · 无 Key');
        const maxIdW = Math.max(6, contentW - 2 - 2 - stringWidth(chips));
        const idText = truncateToWidth(`${e.provider && e.provider !== app.config.get().provider && !e.builtin ? `${e.provider}/` : ''}${id}`, maxIdW);
        return (
          <Box key={e.key}>
            <Text color={isSel ? theme.accent : theme.textFaint}>{isSel ? '▸ ' : '  '}</Text>
            <Text color={isSel ? theme.text : e.builtin ? theme.info : theme.textDim} bold={isSel} wrap="truncate-end">{idText}</Text>
            <Text color={theme.textFaint}>{'  '}{truncateToWidth(chips, Math.max(0, contentW - 2 - stringWidth(idText)))}</Text>
          </Box>
        );
      })}
      {entries.length > viewRows && (
        <Text color={theme.textFaint}>  ↑↓ 共 {entries.length} 项</Text>
      )}

      <Text color={theme.border} wrap="truncate-end">{truncateToWidth(rule, contentW)}</Text>

      {submode ? (
        <Box flexDirection="column" width={contentW}>
          <Box>
            <Text color={theme.accent}>{truncateToWidth(submodeLabel, Math.max(4, contentW - stringWidth(submode.value) - 1))}</Text>
            <Text color={theme.text}>{truncateToWidth(submode.value, Math.max(0, contentW - 1))}</Text>
            <Text color={theme.text}>█</Text>
          </Box>
          {submode.error && <Text color={theme.error} wrap="truncate-end">{truncateToWidth(submode.error, contentW)}</Text>}
          <Box>
            <KeyHint keys="enter" desc="确认" />
            <KeyHint keys="esc" desc="取消" last />
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" width={contentW}>
          <Box>
            <KeyHint keys="↑↓" desc="选择" />
            <KeyHint keys="enter" desc="切换(跨服务商自动带Key)" />
            <KeyHint keys="a" desc="添加" />
            <KeyHint keys="d" desc="删除" />
            <KeyHint keys="k" desc="当前服务商Key" last />
          </Box>
          <Box>
            <KeyHint keys="b" desc="上下文长度" />
            <KeyHint keys="w" desc="上下文窗口" />
            <KeyHint keys="c" desc="思考强度" />
            <KeyHint keys="esc" desc="关闭" last />
          </Box>
        </Box>
      )}
      {toast && <Text color={theme.success} wrap="truncate-end">{truncateToWidth(`✓ ${toast}`, contentW)}</Text>}
    </Box>
  );
}

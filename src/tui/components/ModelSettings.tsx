/** @jsxImportSource react */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import stringWidth from 'string-width';
import type { App } from '../../app/index.js';
import { PROVIDERS, getApiKeyFromEnv, listProviders, isCustomProvider } from '../../config/providers.js';
import { BUILTIN_MODEL_ID } from '../../config/builtin.js';
import type { ProviderName } from '../../config/types.js';
import { theme } from '../theme.js';

type Submode = null | {
  type: 'add' | 'context' | 'window' | 'key' | 'url' | 'provider';
  value: string;
  error?: string;
  /** key/url submode: which provider/model the input is for */
  provider?: ProviderName;
  model?: string;
  /** provider submode: highlighted row in the provider list */
  idx?: number;
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
 * v3.4.9: THE single model/provider dialog. /model, /服务商 and /models all
 * open it. The list holds exactly: the ONE builtin free model, the models
 * the user added themselves, and an add-provider entry (inline key / relay
 * URL prompts). No provider catalogs — users add what they use.
 *
 * Keys:
 *   ↑/↓ 选择   enter 切换   a 添加模型   d 删除自定义
 *   b 回合窗口  w 上下文窗口  c 思考强度  k 当前服务商 API Key   esc 关闭
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
  /** "＋ 配置新的服务商" row */
  addProvider?: boolean;
}

function buildEntries(app: App): Entry[] {
  const c = app.config.get();
  const cur: ProviderName = c.provider;
  const entries: Entry[] = [];
  let n = 0;
  const nextKey = () => `e${n++}`;

  // v3.4.9: user mandate — ONE builtin free model plus what the user added
  // themselves. Provider catalogs (a wall of rows nobody can activate) and
  // cross-provider history are gone; switching providers happens through
  // the 配置服务商 flow below.
  entries.push({ key: nextKey(), sep: '── 内置共享 ──' });
  entries.push({ key: nextKey(), id: BUILTIN_MODEL_ID, provider: 'siliconflow', builtin: true, label: `${BUILTIN_MODEL_ID} · 免费稳定（推荐）` });

  entries.push({ key: nextKey(), sep: '── 我的模型 ──' });
  entries.push({ key: nextKey(), id: c.model, provider: cur, current: true, label: `${c.model} ● 当前` });
  const seen = new Set<string>([`${cur}::${c.model}`]);
  const push = (id: string, provider: ProviderName) => {
    if (!id || seen.has(`${provider}::${id}`)) return;
    seen.add(`${provider}::${id}`);
    entries.push({ key: nextKey(), id, provider });
  };
  for (const m of c.customModels || []) push(m, cur);

  entries.push({ key: nextKey(), sep: '── 添加 ──' });
  entries.push({ key: nextKey(), addProvider: true, label: '＋ 配置自己的服务商（Key / 中转站）…' });
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
  const [toastError, setToastError] = useState(false);
  // custom relay setup is two-step (key → base URL); the key waits here
  const pendingKeyRef = useRef<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  const refresh = () => {
    const next = buildEntries(app);
    setEntries(next);
    return next;
  };

  useEffect(() => {
    setEntries(buildEntries(app));
  }, [toast, submode, app]);

  const currentModel = app.config.get().model;

  const flash = (msg: string, isError = false) => {
    setToastError(isError);
    setToast(isError ? `✗ ${msg}` : msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current); // v3.4.8: timers must not clear each other
    toastTimerRef.current = setTimeout(() => { setToast(null); setToastError(false); rerender(); }, 3000);
  };

  /** True for rows that can be operated on (not section separators). */
  const actionable = (e: Entry | undefined): e is Entry => !!e && !e.sep && (!!e.id || !!e.addProvider);

  /** Loose identity: case + separators insensitive (glm5.3 vs glm-5.3). */
  const normId = (s: string) => s.toLowerCase().replace(/[-_.\s]/g, '');

  const idx = Math.min(Math.max(selected, 0), Math.max(0, entries.length - 1));
  const active = entries[idx];

  const switchTo = async (target: string) => {
    if (!target) return;
    if (target === currentModel) { flash(`${target} 已是当前模型`); return; }
    await app.switchModel(target);
    // v3.4.8: same warning as the /model command path — switching to a
    // provider we hold no key for silently produced 401s before.
    const after = app.config.get();
    if (!after.apiKey && !PROVIDERS[after.provider]?.keyless && !after.useBuiltin) {
      flash('已切换，但该服务商未配置 Key，请求会失败（按 k 配置）', true);
    } else {
      flash(`已切换使用 ${target}`);
    }
  };

  /** v3.4.8: one funnel for every save+switch path (activate, key step,
   *  url step, provider picker). All of them just build an intent; errors
   *  land in the dialog instead of killing the TUI via unhandledRejection. */
  const commitActivation = async (intent: { model?: string; provider?: ProviderName; apiKey?: string; baseUrl?: string; useBuiltin?: boolean }, okMsg: string) => {
    try {
      await app.switchModel(intent.model || app.config.get().model, intent);
      refresh();
      setSubmode(null);
      pendingKeyRef.current = null;
      flash(okMsg);
      rerender();
    } catch (e: any) {
      setSubmode(s => (s ? { ...s, error: `保存失败: ${e?.message || e}` } : s));
    }
  };

  /** Selecting any entry: same provider → plain switch; foreign → provider
   *  + key together, asking for the key inline when we don't hold one. */
  const activate = async (e: Entry) => {
    if (e.addProvider) {
      setSubmode({ type: 'provider', value: '', idx: 0 });
      return;
    }
    if (e.sep || !e.id || !e.provider) return;
    const c = app.config.get();
    const kind = resolveActivation(c, !!getApiKeyFromEnv(e.provider), e);
    try {
      if (kind === 'builtin') {
        await commitActivation({ provider: 'siliconflow', useBuiltin: true, model: BUILTIN_MODEL_ID }, '已切换到内置共享模型（无需 Key）');
        return;
      }
      if (kind === 'same-provider') {
        await switchTo(e.id);
        rerender();
        return;
      }
      if (kind === 'switch-ready') {
        const pc = PROVIDERS[e.provider];
        // v3.4.10: a relay MUST be asked for its URL — the resolved
        // config.baseUrl belongs to the CURRENT provider and is always
        // non-empty, so it must not stand in for the relay's URL.
        if (isCustomProvider(e.provider)) {
          pendingKeyRef.current = getApiKeyFromEnv(e.provider) || null;
          setSubmode({ type: 'url', value: '', provider: e.provider, model: e.id });
          return;
        }
        await commitActivation({ provider: e.provider, model: e.id }, `已切换: ${pc?.name || e.provider} / ${e.id}`);
      } else if (kind === 'need-key') {
        setSubmode({ type: 'key', value: '', provider: e.provider, model: e.id });
      }
    } catch (e2: any) {
      flash(`切换失败: ${e2?.message || e2}`, true);
    }
  };

  const commitSubmode = async () => {
    if (!submode) return;
    try {
      await commitSubmodeInner();
    } catch (e: any) {
      // v3.4.8: a failed save used to escape as unhandledRejection → TUI exit
      setSubmode(s => (s ? { ...s, error: `保存失败: ${e?.message || e}` } : s));
    }
  };

  const commitSubmodeInner = async () => {
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
      // v3.4.10: custom relays ALWAYS continue to the URL step. The old
      // condition (!config.baseUrl) never fired — the in-memory baseUrl is
      // the CURRENT provider's resolved endpoint, always non-empty — so the
      // relay was saved against the wrong host and the user never got asked.
      if (submode.provider && isCustomProvider(submode.provider)) {
        pendingKeyRef.current = key;
        const onThisRelay = app.config.get().provider === submode.provider;
        setSubmode({ type: 'url', value: onThisRelay ? (app.config.get().baseUrl || '') : '', provider: submode.provider, model: submode.model });
        return;
      }
      await commitActivation(
        { provider: submode.provider, apiKey: key, model: submode.model },
        `已保存 ${PROVIDERS[submode.provider!]?.name || submode.provider} 的 Key 并切换`,
      );
    } else if (submode.type === 'url') {
      const existing = submode.provider ? app.config.get().baseUrl : '';
      let url = submode.value.trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(url)) {
        if (!url && existing) url = existing.replace(/\/+$/, ''); // empty enter = keep saved URL
        else if (!url) { setSubmode({ ...submode, error: 'URL 不能为空' }); return; }
        else url = 'https://' + url;
      }
      const provider = submode.provider!;
      await commitActivation(
        {
          provider,
          model: submode.model || PROVIDERS[provider]?.defaultModel || app.config.get().model,
          apiKey: pendingKeyRef.current ?? undefined,
          baseUrl: url,
        },
        `已切换: ${PROVIDERS[provider]?.name || provider} · ${url}`,
      );
    } else if (submode.type === 'context') {
      if (!actionable(active) || !active.id || active.addProvider) { setSubmode(null); flash('请先选一个模型行', true); return; }
      const tgt = active.id;
      const nv = parseInt(submode.value, 10);
      if (!Number.isFinite(nv) || nv < 5 || nv > 1000) {
        setSubmode({ ...submode, error: '消息条数 5-1000（不是 tokens）' });
        return;
      }
      await app.setModelContextLength(tgt, nv);
      setSubmode(null);
      flash(`${tgt} 回合窗口 → ${nv} 条消息（并非 tokens）`);
    } else if (submode.type === 'window') {
      if (!actionable(active) || !active.id || active.addProvider) { setSubmode(null); flash('请先选一个模型行', true); return; }
      const tgt = active.id;
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
    if (!actionable(active) || !active.id) { flash('请先选一个模型行', true); return; }
    const tgt = active.id;
    try {
      const order: Array<'off' | 'low' | 'medium' | 'high'> = ['off', 'low', 'medium', 'high'];
      const now = app.getThinking(tgt);
      const next = order[(order.indexOf(now) + 1) % order.length];
      await app.setModelThinking(tgt, next);
      rerender();
      flash(next === 'off' ? `${tgt} 思考关闭` : `${tgt} 思考强度 → ${next}`);
    } catch (e: any) {
      flash(`设置失败: ${e?.message || e}`, true);
    }
  };

  const deleteSelected = async () => {
    if (!actionable(active) || !active.id) { flash('请先选一个模型行', true); return; }
    const id = active.id;
    if (active.addProvider) return;
    if (id === currentModel) { flash('当前使用中的模型不能删除'); return; }
    if (!(app.config.get().customModels || []).includes(id)) {
      flash('只有自定义添加的模型可以删除');
      return;
    }
    try {
      await app.removeCustomModel(id);
      const next = refresh();
      // land the selection on a real row, never a separator
      const firstReal = next.findIndex(e2 => !e2.sep && !e2.addProvider);
      setSelected(Math.max(0, firstReal));
      flash(`已删除 ${id}`);
    } catch (e: any) {
      flash(`删除失败: ${e?.message || e}`, true);
    }
  };

  // v3.4.8: navigation skips section separators and the add-provider row —
  // the selection used to vanish on a separator and b/w/c/d silently fell
  // back to the CURRENT model.
  const moveSelection = (dir: 1 | -1) => {
    setSelected(prev => {
      let i = prev;
      for (let n = 0; n < entries.length; n++) {
        i = Math.min(entries.length - 1, Math.max(0, i + dir));
        if (actionable(entries[i])) return i;
      }
      return prev;
    });
  };

  useInput((input, key) => {
    if (submode?.type === 'provider') {
      const list = listProviders();
      const pidx = Math.min(Math.max(0, submode.idx ?? 0), list.length - 1);
      if (key.escape) { setSubmode(null); pendingKeyRef.current = null; return; }
      if (key.upArrow) { setSubmode({ ...submode, idx: Math.max(0, pidx - 1) }); return; }
      if (key.downArrow) { setSubmode({ ...submode, idx: Math.min(list.length - 1, pidx + 1) }); return; }
      if (key.return) {
        const p = list[pidx];
        const pc = PROVIDERS[p.key];
        // v3.4.8: keep provider-agnostic custom models across the switch;
        // catalog-bound ids fall back to the new provider's default.
        const c = app.config.get();
        const keepModel = (c.customModels || []).includes(c.model) ? c.model : (pc?.defaultModel || c.model);
        if (pc?.keyless) {
          void commitActivation({ provider: p.key, model: keepModel }, `已切换: ${p.name} / ${keepModel}`);
        } else {
          setSubmode({ type: 'key', value: '', provider: p.key, model: keepModel });
        }
      }
      return;
    }
    if (submode) {
      if (key.escape) { setSubmode(null); pendingKeyRef.current = null; return; }
      if (key.return) { void commitSubmode(); return; }
      if (key.backspace || key.delete) {
        // v3.4.8: delete by CODE POINT — slicing UTF-16 units stranded half
        // a surrogate pair for astral characters (𠮷 → lone low surrogate).
        setSubmode(s => (s ? { ...s, value: Array.from(s.value).slice(0, -1).join(''), error: undefined } : s));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setSubmode(s => (s ? { ...s, value: s.value + input, error: undefined } : s));
      }
      return;
    }

    if (key.escape) { onClose(); return; }
    if (key.upArrow) { moveSelection(-1); return; }
    if (key.downArrow) { moveSelection(1); return; }

    if (key.return) { void activate(active); return; }

    if (input === 'a' || input === 'A') { setSubmode({ type: 'add', value: '' }); return; }
    if (input === 'b' || input === 'B') {
      if (!actionable(active) || !active.id || active.addProvider) { flash('请先选一个模型行', true); return; }
      const id = active.id;
      // v3.6.0 (P2-10): the chip showed the CURRENT model's window for
      // models that never set one — default to the GLOBAL message window.
      const cfg = app.config.get();
      const cur = cfg.modelSettings?.[id]?.contextLength ?? cfg.contextLength ?? 50;
      setSubmode({ type: 'context', value: String(cur) });
      return;
    }
    if (input === 'c' || input === 'C') { void cycleThinking(); return; }
    if (input === 'w' || input === 'W') {
      if (!actionable(active) || !active.id || active.addProvider) { flash('请先选一个模型行', true); return; }
      setSubmode({ type: 'window', value: String(app.getContextWindow(active.id)) });
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
        : submode?.type === 'url' ? '输入中转站 Base URL ❯ '
          : submode?.type === 'window' ? `${truncateToWidth(active?.id || currentModel, 24)} 上下文窗口(tokens) ❯ `
            : `${truncateToWidth(active?.id || currentModel, 24)} 回合窗口(消息条数) ❯ `;

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
        if (e.addProvider) {
          const isSel = e.key === active?.key;
          return (
            <Box key={e.key}>
              <Text color={isSel ? theme.accent : theme.textFaint}>{isSel ? '▸ ' : '  '}</Text>
              <Text color={isSel ? theme.text : theme.textDim} bold={isSel} wrap="truncate-end">{truncateToWidth(e.label!, contentW - 2)}</Text>
            </Box>
          );
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

      {submode?.type === 'provider' ? (
        (() => {
          const list = listProviders();
          const pidx = Math.min(Math.max(0, submode.idx ?? 0), list.length - 1);
          const win = 8;
          const s = list.length > win ? Math.min(Math.max(0, pidx - Math.floor(win / 2)), list.length - win) : 0;
          return (
            <Box flexDirection="column" width={contentW}>
              <Text color={theme.accent} wrap="truncate-end">{truncateToWidth('选择服务商 (↑↓ 回车，esc 取消):', contentW)}</Text>
              {list.slice(s, s + win).map((p, i) => {
                const abs = s + i;
                const mark = abs === pidx ? '▸ ' : '  ';
                const keyNote = PROVIDERS[p.key].keyless || PROVIDERS[p.key].envKeys.length === 0
                  ? '（免 Key）' : (app.config.get().apiKeys?.[p.key] ? '（已配置）' : '');
                return (
                  <Text key={p.key} color={abs === pidx ? theme.accent : theme.textDim} wrap="truncate-end">
                    {truncateToWidth(`${mark}${p.name}${keyNote}`, contentW)}
                  </Text>
                );
              })}
            </Box>
          );
        })()
      ) : submode ? (
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
            <KeyHint keys="enter" desc="切换" />
            <KeyHint keys="a" desc="添加" />
            <KeyHint keys="d" desc="删除" />
            <KeyHint keys="esc" desc="关闭" last />
          </Box>
          <Box>
            <KeyHint keys="k" desc="服务商Key" />
            <KeyHint keys="b" desc="上下文长度" />
            <KeyHint keys="w" desc="窗口" />
            <KeyHint keys="c" desc="思考强度" last />
          </Box>
        </Box>
      )}
      {toast && <Text color={theme.success} wrap="truncate-end">{truncateToWidth(`✓ ${toast}`, contentW)}</Text>}
    </Box>
  );
}

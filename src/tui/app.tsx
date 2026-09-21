/** @jsxImportSource react */
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Box, Static, Text, useStdout } from 'ink';
import chalk from 'chalk';
import { ChatMessage } from './components/ChatMessage.js';
import { Thinking } from './components/Thinking.js';
import { UserInput } from './components/UserInput.js';
import { StatusBar } from './components/StatusBar.js';
import { ModelSettings } from './components/ModelSettings.js';
import { ConfirmPrompt } from './components/ConfirmPrompt.js';
import { Splash } from './components/Splash.js';
import { PlanPanel } from './components/PlanPanel.js';
import { PlanApproval } from './components/PlanApproval.js';
import { useChat } from './hooks/useChat.js';
import { useCommands } from './hooks/useCommands.js';
import { planStore } from '../plan/store.js';
import { clipContentToRows } from './window.js';
import type { App, ConfirmRequest } from '../app/index.js';
import { SessionManager } from '../session/index.js';
import type { MessageData } from './components/ChatMessage.js';
import { estimateTokens } from '../utils/tokens.js';
import { theme } from './theme.js';
import { getVersion } from '../version.js';
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

interface Props {
  app: App;
}

type ViewMode = 'chat' | 'model_settings';

/**
 * v3.4.12 (user mandate — 不要翻页): INLINE layout, the Claude Code /
 * codex shape. Committed messages render ONCE through Ink <Static> and
 * live in the terminal's own scrollback — nothing is ever clipped, the
 * terminal's native scrolling IS the history. Below the Static sits a
 * small live region (streaming tail, thinking, plan, status chip, input).
 * ↑/↓ belong to input history again; the mouse wheel scrolls natively.
 */
export function TuiApp({ app }: Props) {
  const { messages, isThinking, queuedMessage, streamingView, sendMessage, cancel, hydrateMessages, clearMessages } = useChat(app);
  const { handleCommand } = useCommands(app);
  const [systemMessages, setSystemMessages] = useState<MessageData[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;
  // v3.4.15: rows are back (inline mode) — the splash centers vertically.
  const terminalRows = (stdout as any)?.rows || 24;
  /**
   * v3.0.8 fix (user report): maximizing the window left the layout at the
   * old size — force a re-render on resize.
   */
  const [, setResizeTick] = useState(0);
  useEffect(() => {
    const onResize = () => setResizeTick(t => t + 1);
    (stdout as any)?.on?.('resize', onResize);
    return () => { (stdout as any)?.off?.('resize', onResize); };
  }, [stdout]);

  const [cacheSnapshot, setCacheSnapshot] = useState(() => app.cacheStats.snapshot());
  const [resolvedTtl, setResolvedTtl] = useState<'5m' | '1h' | null>(app.resolvedTtl);
  const thinking = app.getThinking();
  useEffect(() => {
    setCacheSnapshot(app.cacheStats.snapshot());
    setResolvedTtl(app.resolvedTtl);
  }, [messages.length]);

  // 1s heartbeat so the status chip stays live even when idle.
  const [, setHeartbeat] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setHeartbeat(h => h + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const addMsg = useCallback((content: string) => {
    setSystemMessages(prev => [...prev, { role: 'assistant', content }]);
  }, []);

  // ── v3.0.5: permission prompt wiring ──────────────────────
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const confirmResolveRef = useRef<((v: { allowed: boolean; always: boolean }) => void) | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    app.confirmHandler = (req) => new Promise<boolean>((resolve) => {
      setConfirmReq(req);
      // v3.4.2: the timer is per-request. A shared timer used to survive
      // its own request being answered and later deny the NEXT prompt at
      // the OLD deadline (ask A at :00, answer at :10, prompt B at :10 →
      // B denied at :60 without its own 60s).
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      const timer = setTimeout(() => {
        confirmResolveRef.current?.({ allowed: false, always: false });
      }, 60000);
      timer.unref?.();
      confirmTimerRef.current = timer;
      confirmResolveRef.current = (v: { allowed: boolean; always: boolean }) => {
        clearTimeout(timer);
        confirmTimerRef.current = null;
        setConfirmReq(null);
        confirmResolveRef.current = null;
        if (v.always && app.permissionMode !== 'accept') {
          app.setYolo(true);
          setSystemMessages(prev => [
            ...prev,
            { role: 'assistant', content: '✓ 本会话已切换为自动确认（/yolo 可关回）。' },
          ]);
        }
        resolve(v.allowed);
      };
    });
    app.session.onAutoCompact = (info) => {
      setSystemMessages(prev => [
        ...prev,
        { role: 'assistant', content: `⚠️ 上下文较长（${info.before} 条），已自动压缩到 ${info.after} 条（工具调用块保持完整）。可用 /resume 随时找回历史。` },
      ]);
    };
    // v3.1.0: offer plan approval when a turn completes in plan mode.
    app.onTurnComplete = () => {
      if (app.permissionMode === 'plan') setPlanApproval(true);
    };
    return () => {
      app.confirmHandler = undefined;
      app.onTurnComplete = undefined;
    };
  }, [app]);

  const onConfirmAnswer = useCallback((allowed: boolean, always: boolean) => {
    confirmResolveRef.current?.({ allowed, always });
  }, []);

  // ── v3.1.0: plan mode (/计划模式) — approval after each turn ──
  const [planApproval, setPlanApproval] = useState(false);
  const onPlanApproval = useCallback((decision: 'approve' | 'stay' | 'exit') => {
    setPlanApproval(false);
    if (decision === 'approve') {
      app.setFullPermission(); // red mode
      addMsg('✓ 计划已批准 — 已进入完整权限模式（红色标识），开始按计划执行。');
      sendMessage('计划已批准。请严格按照上面的计划开始实现；现在拥有完整权限，执行中的写/操作不再询问。');
    } else if (decision === 'stay') {
      addMsg('🔵 继续计划模式（只读）。可继续研究或调整计划；再次完成任务后会重新询问。');
    } else {
      app.setPlanMode(false);
      addMsg('✓ 已退出计划模式，回到默认确认模式。');
    }
  }, [app, addMsg, sendMessage]);

  const onSubmit = useCallback(async (input: string) => {
    const result = handleCommand(input);

    if (result.handled) {
      if (result.action === 'model_settings') {
        setViewMode('model_settings');
        return;
      }

      if (result.output) {
        setSystemMessages(prev => [
          ...prev,
          { role: 'user', content: input },
          { role: 'assistant', content: result.output! },
        ]);
      }

      if (result.action === 'clear') {
        setSystemMessages([]);
        // v3.0.16: /new resets the session — reset the visible list too
        // (useChat messages are display-only now).
        clearMessages();
      }

      // v3.0.16: /browser — verifyLaunch is async (spawns Chromium), so
      // handleCommand only returns the action and we run the check here,
      // posting the report as a chat notice (same pattern as /models).
      if (result.action === 'browser_check') {
        const c = app.config.get() as any;
        const setup = c.browserSetup as { done?: boolean; mode?: string } | undefined;
        const configLine = !setup?.done
          ? '配置: 未配置（首次运行 gfcode 时会询问是否安装）'
          : setup.mode === 'chromium'
            ? '配置: 已安装内置 Chromium'
            : `配置: ${setup.mode === 'declined' ? '已跳过安装' : setup.mode}`;
        addMsg('正在检查浏览器（启动内置 Chromium…）');
        const { BrowserTool } = await import('../tools/browser.js');
        const mode = await BrowserTool.verifyLaunch();
        addMsg([
          '🌐 浏览器工具状态',
          `  ${configLine}`,
          mode
            ? '  启动: ✓ 可用（内置 Chromium 正常）'
            : '  启动: ✗ 不可用。运行 `npx playwright install chromium` 后重试。',
        ].join('\n'));
      }

      if (result.action === 'init_agents') {
        // v3.0.20 (Codex /init parity): scan the project, have the LLM draft
        // an AGENTS.md, confirm, write. Runs here because it needs async LLM
        // access + the confirmation dialog.
        addMsg('正在扫描项目并生成 AGENTS.md…');
        try {
          const cwd = process.cwd();
          const SKIP = new Set(['node_modules', 'dist', 'build', '.git', '.nwt', 'coverage']);
          const top = readdirSync(cwd, { withFileTypes: true })
            .filter(e => !e.name.startsWith('.') && !SKIP.has(e.name))
            .slice(0, 40)
            .map(e => (e.isDirectory() ? e.name + '/' : e.name));
          let pkgInfo = '';
          try {
            const p = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
            pkgInfo = [
              `name: ${p.name}`,
              `scripts: ${Object.keys(p.scripts || {}).join(', ')}`,
              `dependencies: ${Object.keys(p.dependencies || {}).slice(0, 20).join(', ')}`,
            ].join('\n');
          } catch { /* not a node project */ }
          let readme = '';
          try { readme = readFileSync(join(cwd, 'README.md'), 'utf-8').slice(0, 1200); } catch { /* optional */ }

          const prompt = [
            '为当前项目生成一份 AGENTS.md（AI 编码代理的项目说明书）。只输出 Markdown 正文，不要包裹代码围栏，不要额外解释。',
            '',
            '要求：',
            '- 开头一行项目一句话简介',
            '- 列出：技术栈、常用命令（构建/测试/运行）、目录结构要点、编码约定（能推断多少写多少，不确定的不要编造）',
            '- 全文控制在 60 行以内，简体中文',
            '',
            `顶层文件/目录:\n${top.join('\n')}`,
            pkgInfo ? `\npackage.json:\n${pkgInfo}` : '',
            readme ? `\nREADME 摘录:\n${readme}` : '',
          ].filter(Boolean).join('\n');

          const resp = await app.llm.chat([{ role: 'user', content: prompt }], { maxTokens: 2000 });
          let md = (resp.content || '').trim();
          const fence = md.match(/```(?:markdown)?\n([\s\S]*?)```/);
          if (fence && /^#\s|^-{3,}/.test(fence[1].trim())) md = fence[1].trim();
          if (!md) {
            addMsg('✗ 生成失败：模型返回为空。');
            return;
          }
          if (existsSync(join(cwd, 'AGENTS.md'))) {
            const ok = await app.requestConfirmation({ message: `AGENTS.md 已存在，覆盖写入？\n\n${md.slice(0, 800)}` });
            if (!ok) {
              addMsg('已取消：AGENTS.md 未改动。');
              return;
            }
          }
          writeFileSync(join(cwd, 'AGENTS.md'), md + '\n', 'utf-8');
          addMsg(`✓ 已生成 AGENTS.md（${md.split('\n').length} 行）。之后每次会话会自动注入系统提示；也可用 /new 立即生效。`);
        } catch (e: any) {
          addMsg(`✗ 生成失败: ${e.message || e}`);
        }
        return;
      }

      if (result.action === 'switch_model' && result.payload) {
        // v3.4.2: ownership-checked switch (may auto-change provider).
        const notice = await app.switchModelChecked(result.payload);
        setSystemMessages(prev => [...prev, { role: 'assistant', content: notice }]);
        setResolvedTtl(null);
      }

      if (result.action === 'apply_ttl' && result.payload) {
        await app.applyTtl(result.payload as '5m' | '1h');
        setResolvedTtl(result.payload);
      }

      if (result.action === 'resume') {
        const list = SessionManager.list(10);
        const summary = list[result.payload as number];
        if (!summary) {
          addMsg('恢复失败：找不到该序号的会话，请先运行 /resume 查看列表。');
          return;
        }
        const file = SessionManager.load(summary.id);
        if (!file) {
          addMsg('恢复失败：会话文件损坏或已被清理。');
          return;
        }
        app.session.loadFrom(file);
        const visible: MessageData[] = [];
        for (const m of file.messages) {
          if (m.role === 'user' && typeof m.content === 'string') {
            visible.push({ role: 'user', content: m.content });
          } else if (m.role === 'assistant' && typeof m.content === 'string') {
            visible.push({ role: 'assistant', content: m.content });
          } else if (m.role === 'tool' && typeof m.content === 'string') {
            // v3.3.0: tool results now persist — show them as ⎿ summary
            // lines so a restored session keeps its tool dimension visible.
            const name = (m as { name?: string }).name || 'tool';
            const preview = m.content.length > 140 ? m.content.slice(0, 140) + '…' : m.content;
            visible.push({ role: 'assistant', content: `⎿ ${name}: ${preview.replace(/\n/g, ' ')}`, plain: true, dim: true });
          }
        }
        setSystemMessages([]);
        hydrateMessages(visible);
        const model = file.model ? `（模型: ${file.model}）` : '';
        addMsg(`✓ 已恢复会话 ${summary.id.slice(0, 24)}…，共 ${visible.length} 条可见消息${model}。输入 /模型 <名称> 可切换模型。`);
      }

      return;
    }

    sendMessage(input);
  }, [handleCommand, sendMessage, app, viewMode, addMsg, hydrateMessages, clearMessages]);

  const allMessages = [...systemMessages, ...messages];
  const activeSkills = app.skills.listActive().map(s => s.id);
  const splashMode = allMessages.length === 0;
  const cfg = app.config.get();

  // ── v3.4.12 live-region metrics (inline mode — no frame-height budget
  // needed; the terminal scrollback holds the transcript). The streaming
  // tail is capped so the live block stays compact; the status chip carries
  // what the old right-hand panel showed.
  const chatWidth = terminalWidth - 4;
  const streamView = streamingView
    ? clipContentToRows(streamingView, chatWidth, 10)
    : null;
  const contextBreakdown = useMemo(() => {
    try {
      const bd = app.prompts.estimateBreakdown();
      let msgTokens = 0;
      for (const m of app.session.getMessages()) {
        // the session stores the SYSTEM message too — counting it here
        // double-counted the prompt (消息 showed an inflated 45%).
        if ((m as { role?: string }).role === 'system') continue;
        const c = (m as { content?: unknown }).content;
        msgTokens += estimateTokens(typeof c === 'string' ? c : JSON.stringify(c ?? '')) + 4;
      }
      return { ...bd, msgTokens };
    } catch { return null; }
  }, [app, allMessages.length, app.permissionMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const usedTokens = contextBreakdown
    ? (app.sessionStats.promptTokens > 0
      ? app.sessionStats.promptTokens
      : contextBreakdown.systemPrompt + contextBreakdown.systemTools
        + contextBreakdown.mcpTools + contextBreakdown.skills
        + contextBreakdown.msgTokens + 64)
    : 0;
  const ctxWin = app.getContextWindow();
  const ctxPct = ctxWin > 0 ? Math.min(100, Math.round((usedTokens / ctxWin) * 100)) : 0;
  const hitPct = cacheSnapshot.totalRequests > 0 ? Math.round(cacheSnapshot.hitRate * 100) : null;

  // v3.0.11: chat mode input spans the full terminal width; splash keeps
  // the centered fixed-width block.
  const inputArea = confirmReq ? (
    <ConfirmPrompt message={confirmReq.message} onAnswer={onConfirmAnswer} />
  ) : planApproval ? (
    <PlanApproval onAnswer={onPlanApproval} />
  ) : (
    <UserInput
      onSubmit={onSubmit}
      // esc with empty input cancels the running turn (no pager anymore).
      onCancel={() => { cancel(); }}
      disabled={false}
      mode={app.permissionMode === 'plan' ? 'Plan' : app.permissionMode === 'accept' ? 'YOLO' : 'Build'}
      provider={cfg.provider}
      model={cfg.model}
      thinking={thinking}
      fullWidth={!splashMode}
      width={splashMode ? Math.min(terminalWidth - 4, 64) : undefined}
    />
  );

  // v3.1.0: colored mode badge — blue for plan mode, red for full permission.
  const modeBadge = app.permissionMode === 'plan' ? (
    <Box paddingLeft={1}>
      <Text color={theme.info} bold>● 计划模式（只读）</Text>
      <Text color={theme.textDim}> — 研究中，写/执行被拒绝；批准计划后进入完整权限模式</Text>
    </Box>
  ) : app.permissionMode === 'accept' ? (
    <Box paddingLeft={1}>
      <Text color={theme.error} bold>● 完整权限模式（YOLO）</Text>
      <Text color={theme.textDim}> — 写/执行不再确认；/yolo 切回</Text>
    </Box>
  ) : null;

  // /models opens as a centered modal (live region). A pending permission
  // confirm must win over the dialog.
  if (viewMode === 'model_settings') {
    if (confirmReq) {
      return (
        <Box flexDirection="column" width={terminalWidth} justifyContent="center" alignItems="center">
          <ConfirmPrompt message={confirmReq.message} onAnswer={onConfirmAnswer} />
        </Box>
      );
    }
    return (
      <Box flexDirection="column" width={terminalWidth} justifyContent="center" alignItems="center">
        <ModelSettings
          app={app}
          onClose={() => setViewMode('chat')}
          width={Math.min(terminalWidth - 2, 72)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={terminalWidth} paddingX={1}>
      {/* Committed transcript → terminal scrollback (rendered once each).
          History is never clipped; the terminal's own scrolling is the pager. */}
      <Static items={allMessages}>
        {(m, i) => (
          <ChatMessage key={`${i}-${m.role}-${m.content.slice(0, 8)}`} message={m} width={chatWidth} />
        )}
      </Static>

      {splashMode ? (
        <>
          {/* v3.4.15: center the splash block vertically in the viewport
              (the startup clear leaves the cursor at row 1). The block is
              ~16 rows; the pad lives in the live region and disappears
              with the splash once the conversation starts. */}
          <Box height={Math.max(0, Math.floor((terminalRows - 16) / 2))} />
          <Splash />
          {modeBadge}
          <Box justifyContent="center">{inputArea}</Box>
          <Box justifyContent="center" paddingTop={1}>
            <Text color={theme.textFaint}>
              <Text color={theme.accent}>◆ Tip </Text>
              {' '}/models 可添加模型、设置上下文长度和思考强度 · /help 查看全部命令
            </Text>
          </Box>
          {app.usingBuiltinModel && (
            <Box justifyContent="center" paddingBottom={1}>
              <Text color={theme.textFaint}>
                <Text color={theme.info}>ℹ </Text>
                未配置 API Key · 正在使用内置共享模型 Qwen/Qwen3.5-4B（共享额度） · gfcode init 配置自己的
              </Text>
            </Box>
          )}
        </>
      ) : (
        <>
          {streamView && (
            <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
              <Text color={theme.textFaint}>
                ▪ {app.permissionMode === 'plan' ? 'Plan' : app.permissionMode === 'accept' ? 'YOLO' : 'Build'}{cfg.model ? ` · ${cfg.model}` : ''}（生成中…）
              </Text>
              {/* plain text while streaming; the full message joins the
                  scrollback once the turn commits. */}
              <Text>{streamView}</Text>
            </Box>
          )}
          <Thinking active={isThinking} />
          <PlanPanel width={chatWidth} />
          {queuedMessage && (
            <Box paddingLeft={1}>
              <Text color={theme.warning}>📎 已排队: </Text>
              <Text color={theme.textDim}>{queuedMessage}</Text>
            </Box>
          )}
          {modeBadge}
          {/* status chip: the essence of the old right-hand panel */}
          {!splashMode && (
            <Box paddingLeft={1}>
              <Text color={theme.textFaint} wrap="truncate-end">
                ◇ 上下文 {fmtWan(usedTokens)}/{fmtWan(ctxWin)}（{ctxPct}%） · 缓存命中 {hitPct === null ? '—' : `${hitPct}%`} · ↑{fmtWan(cacheSnapshot.totalInputTokens)} ↓{fmtWan(cacheSnapshot.totalOutputTokens)} · 回合窗口 {app.session.getMaxMessages()} 条
              </Text>
            </Box>
          )}
          {inputArea}
        </>
      )}
      {splashMode && (
        <StatusBar
          messageCount={allMessages.length}
          skills={activeSkills}
          provider={cfg.provider}
          model={cfg.model}
        />
      )}
      {splashMode && (
        <Box justifyContent="space-between" width="100%">
          <Text color={theme.textFaint}>~</Text>
          <Text color={theme.textFaint}>v{getVersion()}{app.permissionMode === 'accept' ? ' · yolo' : ''}</Text>
        </Box>
      )}
    </Box>
  );
}

/** 33000 → "3.3万" (matches the old ContextPanel formatting). */
function fmtWan(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 10000) return String(Math.round(n));
  const w = n / 10000;
  const s = w >= 100 ? String(Math.round(w)) : w.toFixed(1).replace(/\.0$/, '');
  return `${s}万`;
}

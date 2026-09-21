/** @jsxImportSource react */
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
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
import { ContextPanel } from './components/ContextPanel.js';
import { useChat } from './hooks/useChat.js';
import { useCommands } from './hooks/useCommands.js';
import { planStore } from '../plan/store.js';
import { buildWindow, estimateMsgLines, clipContentToRows, maxUsefulScroll } from './window.js';
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
 * v3.4.17: full-screen three-zone TUI (user mandate — opencode parity):
 *   left   transcript viewport (mouse wheel / ↑↓ scroll the full history)
 *          with the streaming tail, plan, queue and input pinned to the
 *          bottom of the column
 *   right  info sidebar (context breakdown, ↑↓, cache, 回合窗口), full height
 *   bottom input
 * Alternate screen: entering swaps buffers (clean start), exiting restores
 * the shell screen verbatim.
 */
export function TuiApp({ app }: Props) {
  const { messages, isThinking, queuedMessage, streamingView, sendMessage, cancel, hydrateMessages, clearMessages } = useChat(app);
  const { handleCommand } = useCommands(app);
  const [systemMessages, setSystemMessages] = useState<MessageData[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;
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

  // v3.4.8: splash ⇄ chat switches repaint through Ink's line-diff and can
  // leave the previous layout's remnants in the alt buffer. One frame at
  // FULL viewport height forces Ink's whole-screen clear; then back to
  // rows-1 (Ink 7.1 on Windows full-clears when frame == viewport height).
  const [tallFrame, setTallFrame] = useState(false);

  const [cacheSnapshot, setCacheSnapshot] = useState(() => app.cacheStats.snapshot());
  const [resolvedTtl, setResolvedTtl] = useState<'5m' | '1h' | null>(app.resolvedTtl);
  const thinking = app.getThinking();
  useEffect(() => {
    setCacheSnapshot(app.cacheStats.snapshot());
    setResolvedTtl(app.resolvedTtl);
  }, [messages.length]);

  // 1s heartbeat so the sidebar/chip stays live even when idle.
  const [, setHeartbeat] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setHeartbeat(h => h + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // v3.4.19: ctrl+o toggles tool-call detail (collapsed one-liners by
  // default; expanded shows the full command + result preview). The
  // transcript stays scannable no matter how many tools run.
  const [toolExpanded, setToolExpanded] = useState(false);
  useInput((input, key) => {
    if (key.ctrl && input === 'o') setToolExpanded(v => !v);
  });

  // v3.4.17: transcript viewport scroll (mouse wheel delivers ↑/↓ in the
  // alternate screen; also ↑/↓ on an empty input). Full-history window via
  // buildWindow, clamped at the useful ceiling.
  const [scroll, setScroll] = useState<number | null>(null);
  const allMessagesRef = useRef<MessageData[]>([]);
  const scrollBy = useCallback((d: number) => {
    setScroll(prev => {
      const next = (prev ?? 0) + d;
      const w = terminalWidth - 4 - (terminalWidth >= 100 ? 40 : 0);
      const budget = Math.max(3, terminalRows - 11);
      const max = maxUsefulScroll(allMessagesRef.current, w, budget);
      if (max === 0) return null;
      return next <= 0 ? null : Math.min(next, max);
    });
  }, [terminalWidth, terminalRows]);

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
        // v3.6.0 (P1-2): a restored session's real size is unknown until
        // the next usage report — stale counters from the previous session
        // kept showing in the sidebar and get_context_remaining.
        app.resetSessionStats();
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
  allMessagesRef.current = allMessages;
  const activeSkills = app.skills.listActive().map(s => s.id);
  const splashMode = allMessages.length === 0;
  // v3.4.8: splash ⇄ chat full-height frame (alt-buffer remnant kill).
  const prevSplash = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevSplash.current === null) { prevSplash.current = splashMode; return; }
    if (prevSplash.current !== splashMode) {
      prevSplash.current = splashMode;
      setTallFrame(true);
      const t = setTimeout(() => setTallFrame(false), 120);
      return () => clearTimeout(t);
    }
  }, [splashMode]);
  const cfg = app.config.get();

  // ── three-zone metrics: the frame is rows-1 (never rows — Ink 7.1 on
  // Windows full-clears at exact viewport height). Bottom stack is
  // measured where possible; the transcript window gets what remains.
  const PANEL_WIDTH = 36;
  const SIDEBAR_RESERVE = PANEL_WIDTH + 3; // divider + padding
  const showSidebar = terminalWidth >= 100;
  const [inputRows, setInputRows] = useState(6);
  const chatWidth = terminalWidth - 4 - (showSidebar ? SIDEBAR_RESERVE : 0);
  const streamView = streamingView
    ? clipContentToRows(streamingView, chatWidth, 8)
    : null;
  const streamEst = streamView ? estimateMsgLines({ role: 'assistant', content: streamView }, chatWidth) + 2 : 0;
  const modalRows = confirmReq ? 17 : planApproval ? 7 : 0;
  const bottomStack =
    modalRows > 0 ? modalRows
      : streamEst + (isThinking ? 1 : 0) + (queuedMessage ? 1 : 0)
        + (app.permissionMode !== 'ask' ? 1 : 0)
        + (showSidebar ? 0 : 1) // PlanPanel fallback line when narrow
        + inputRows;
  const windowHeaderRows = scroll !== null ? 1 : 0;
  // one spare line of slack — an off-by-one estimate must not stretch the row
  const workspaceRows = Math.max(3, terminalRows - 2 - bottomStack);
  const win = buildWindow(allMessages, scroll, chatWidth, workspaceRows - windowHeaderRows);
  const maxScroll = maxUsefulScroll(allMessages, chatWidth, workspaceRows);
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
  // v3.6.0 (P1-3/P2-8): one live-estimate source for the sidebar. The old
  // fallback formula skipped the tool-instructions segment, and the switch
  // from fallback to last-round usage made the number jump ~104% on round
  // one. currentContextEstimate() is the same math preCall uses.
  const usedTokens = app.sessionStats.promptTokens > 0
    ? app.sessionStats.promptTokens
    : app.currentContextEstimate();
  const ctxWin = app.getContextWindow();
  const ctxPct = ctxWin > 0 ? Math.min(100, Math.round((usedTokens / ctxWin) * 100)) : 0;
  // v3.4.16: SESSION sums (↑↓/cache) — the lifetime store confused a fresh
  // "你好" with ↑107万. /cache keeps the lifetime view.
  const sStats = app.sessionStats;
  const sessHit = sStats.inputTokens > 0 ? sStats.cachedTokens / sStats.inputTokens : null;

  // v3.0.11: chat mode input spans the left column; splash keeps the
  // centered fixed-width block.
  const inputArea = confirmReq ? (
    <ConfirmPrompt message={confirmReq.message} onAnswer={onConfirmAnswer} />
  ) : planApproval ? (
    <PlanApproval onAnswer={onPlanApproval} />
  ) : (
    <UserInput
      onSubmit={onSubmit}
      // esc: exit the transcript scroll first, else cancel the turn.
      onCancel={() => {
        if (scroll !== null) { setScroll(null); return; }
        cancel();
      }}
      disabled={false}
      mode={app.permissionMode === 'plan' ? 'Plan' : app.permissionMode === 'accept' ? 'YOLO' : 'Build'}
      provider={cfg.provider}
      model={cfg.model}
      thinking={thinking}
      fullWidth={!splashMode}
      width={splashMode ? Math.min(terminalWidth - 4, 64) : undefined}
      onEmptyUp={splashMode ? undefined : () => scrollBy(1)}
      onEmptyDown={splashMode ? undefined : () => scrollBy(-1)}
      onLayoutRows={setInputRows}
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

  // /models opens as a centered modal over the frame. A pending permission
  // confirm must win over the dialog.
  if (viewMode === 'model_settings') {
    if (confirmReq) {
      return (
        <Box flexDirection="column" height={terminalRows - 1} width={terminalWidth} justifyContent="center" alignItems="center">
          <ConfirmPrompt message={confirmReq.message} onAnswer={onConfirmAnswer} />
        </Box>
      );
    }
    return (
      <Box flexDirection="column" height={terminalRows - 1} width={terminalWidth} justifyContent="center" alignItems="center">
        <ModelSettings
          app={app}
          onClose={() => setViewMode('chat')}
          width={Math.min(terminalWidth - 2, 72)}
          maxRows={Math.max(4, terminalRows - 12)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={terminalWidth} paddingX={1} height={tallFrame ? terminalRows : terminalRows - 1}>
      {splashMode ? (
        <Box flexDirection="column" flexGrow={1} justifyContent="center">
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
            <Box justifyContent="center" paddingTop={1}>
              <Text color={theme.textFaint}>
                <Text color={theme.info}>ℹ </Text>
                未配置 API Key · 正在使用内置共享模型 Qwen/Qwen3.5-4B（共享额度） · gfcode init 配置自己的
              </Text>
            </Box>
          )}
          <StatusBar
            messageCount={allMessages.length}
            skills={activeSkills}
            provider={cfg.provider}
            model={cfg.model}
          />
          <Box justifyContent="space-between" width="100%">
            <Text color={theme.textFaint}>~</Text>
            <Text color={theme.textFaint}>v{getVersion()}{app.permissionMode === 'accept' ? ' · yolo' : ''}</Text>
          </Box>
        </Box>
      ) : (
        // v3.4.18: BOTH columns are pinned to the same explicit height with
        // overflow hidden. The left column's real render height occasionally
        // exceeded its estimate, stretched the row, and the unsized sidebar
        // smeared into it (user screenshot). Fixed heights = fixed frame.
        <Box flexDirection="row" width={terminalWidth} height={terminalRows - 1} overflow="hidden">
          <Box flexDirection="column" width={chatWidth} height={terminalRows - 1} overflow="hidden">
            {scroll !== null && (
              <Text color={theme.textFaint}>
                ── 滚动查看 {Math.min(scroll, maxScroll)}/{maxScroll} · ↑ 更早 · ↓ 返回 · esc 回到最新 ──
              </Text>
            )}
            {win.messages.map((m, i) => (
              <ChatMessage key={`${win.start + i}-${m.role}-${m.content.slice(0, 8)}`} message={m} width={chatWidth} toolExpanded={toolExpanded} />
            ))}
            <Box flexGrow={1} />
            {streamView && (
              <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
                <Text color={theme.textFaint}>
                  ▪ {app.permissionMode === 'plan' ? 'Plan' : app.permissionMode === 'accept' ? 'YOLO' : 'Build'}{cfg.model ? ` · ${cfg.model}` : ''}（生成中…）
                </Text>
                <Text>{streamView}</Text>
              </Box>
            )}
            <Thinking active={isThinking} />
            {!showSidebar && <PlanPanel width={chatWidth} />}
            {queuedMessage && (
              <Box paddingLeft={1}>
                <Text color={theme.warning}>📎 已排队: </Text>
                <Text color={theme.textDim}>{queuedMessage}</Text>
              </Box>
            )}
            {modeBadge}
            {!showSidebar && (
              <Box paddingLeft={1}>
                <Text color={theme.textFaint} wrap="truncate-end">
                  ◇ 上下文 {fmtWan(usedTokens)}/{fmtWan(ctxWin)}（{ctxPct ?? 0}%） · 缓存命中 {sessHit === null ? '—' : `${Math.round(sessHit * 100)}%`} · ↑{fmtWan(sStats.inputTokens)} ↓{fmtWan(sStats.outputTokens)} · 回合窗口 {app.session.getMaxMessages()} 条
                </Text>
              </Box>
            )}
            {inputArea}
          </Box>
          {/* RIGHT: info sidebar, same pinned height as the left column */}
          {showSidebar && (
            <Box flexDirection="column" flexShrink={0} borderLeft borderStyle="single" borderColor={theme.border} paddingLeft={2} width={PANEL_WIDTH + 3} height={terminalRows - 1} overflow="hidden">
              <ContextPanel
                used={usedTokens}
                window={ctxWin}
                hitRate={sessHit}
                inTokens={sStats.inputTokens}
                outTokens={sStats.outputTokens}
                maxMessages={app.session.getMaxMessages()}
                width={PANEL_WIDTH}
                title={new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-')}
                categories={[
                  { label: '系统工具', tokens: contextBreakdown?.systemTools ?? 0 },
                  { label: '消息', tokens: contextBreakdown?.msgTokens ?? 0 },
                  { label: '技能', tokens: contextBreakdown?.skills ?? 0 },
                  { label: '系统提示词', tokens: contextBreakdown?.systemPrompt ?? 0 },
                  { label: 'MCP 工具', tokens: contextBreakdown?.mcpTools ?? 0 },
                ]}
              />
              <Box flexGrow={1} />
              <PlanPanel width={PANEL_WIDTH} />
              <Box justifyContent="space-between" width={PANEL_WIDTH}>
                <Text color={theme.textFaint}>~</Text>
                <Text color={theme.textFaint}>v{getVersion()}{app.permissionMode === 'accept' ? ' · yolo' : ''}</Text>
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

/** 33000 → "3.3万" (sidebar/chip formatting). */
function fmtWan(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 10000) return String(Math.round(n));
  const w = n / 10000;
  const s = w >= 100 ? String(Math.round(w)) : w.toFixed(1).replace(/\.0$/, '');
  return `${s}万`;
}

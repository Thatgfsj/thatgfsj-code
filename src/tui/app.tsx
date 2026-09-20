/** @jsxImportSource react */
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import chalk from 'chalk';
import { ChatMessage } from './components/ChatMessage.js';
import { Markdown } from './components/Markdown.js';
import { Thinking } from './components/Thinking.js';
import { UserInput } from './components/UserInput.js';
import { StatusBar } from './components/StatusBar.js';
import { ModelSelector } from './components/ModelSelector.js';
import { InitWizard } from './components/InitWizard.js';
import { ModelSettings } from './components/ModelSettings.js';
import { ConfirmPrompt } from './components/ConfirmPrompt.js';
import { Splash } from './components/Splash.js';
import { PlanPanel } from './components/PlanPanel.js';
import { PlanApproval } from './components/PlanApproval.js';
import { ContextPanel } from './components/ContextPanel.js';
import { useChat } from './hooks/useChat.js';
import { useCommands } from './hooks/useCommands.js';
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

type ViewMode = 'chat' | 'model_select' | 'init_wizard' | 'model_settings';

/**
 * v3.0.8 (opencode-style full-screen layout): the app owns the whole
 * terminal (render fullscreen). First screen is a centered splash logo
 * with the input right under it; once the conversation starts, the chat
 * list fills the viewport and the input pins to the bottom. The version
 * sits in the bottom-right corner at all times.
 */
export function TuiApp({ app }: Props) {
  const { messages, isThinking, queuedMessage, streamingView, sendMessage, cancel, hydrateMessages, clearMessages } = useChat(app);
  const { handleCommand } = useCommands(app);
  const [systemMessages, setSystemMessages] = useState<MessageData[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;
  // v3.2.2: fall back to 24 (Ink's own terminal-size default), never 30 —
  // an over-guess made the frame taller than the real viewport.
  const terminalRows = (stdout as any)?.rows || 24;
  /**
   * v3.0.8 fix (user report): maximizing the window left the layout at the
   * old size — Ink replays the last computed frame on resize, but React
   * never re-renders, so rows/columns went stale. Force a re-render when
   * the terminal is resized.
   */
  const [, setResizeTick] = useState(0);
  useEffect(() => {
    const onResize = () => setResizeTick(t => t + 1);
    (stdout as any)?.on?.('resize', onResize);
    return () => { (stdout as any)?.off?.('resize', onResize); };
  }, [stdout]);

  const [cacheSnapshot, setCacheSnapshot] = useState(() => app.cacheStats.snapshot());
  const [resolvedTtl, setResolvedTtl] = useState<'5m' | '1h' | null>(app.resolvedTtl);
  const configTtl = (app.config.get() as any).cache?.ttl as 'auto' | '5m' | '1h' | undefined;
  const thinking = app.getThinking();
  useEffect(() => {
    setCacheSnapshot(app.cacheStats.snapshot());
    setResolvedTtl(app.resolvedTtl);
  }, [messages.length]);

  // v3.2.1: 1s heartbeat so the right-hand info column (plan + context
  // panel) updates in real time even when nothing else re-renders the
  // frame — the user asked for 要让 agent 及时更新.
  const [, setHeartbeat] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setHeartbeat(h => h + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // v3.2.1: conversation pager (翻页). scroll = messages hidden from the
  // bottom; null = live tail. ↑/↓ on an EMPTY input drive it — which also
  // gives the mouse wheel paging, since terminals deliver wheel events as
  // ↑/↓ inside the alternate screen (that used to recall old inputs).
  const [scroll, setScroll] = useState<number | null>(null);
  const allMessagesRef = useRef<MessageData[]>([]);
  const scrollBy = useCallback((d: number) => {
    setScroll(prev => {
      const next = (prev ?? 0) + d;
      // v3.4.1: clamp at the USEFUL ceiling — past it the window would only
      // hide the newest messages without revealing anything older (at the
      // old length-1 clamp the pager showed nothing but the first message).
      const w = terminalWidth - 4 - (terminalWidth >= 100 ? 41 : 0);
      const budget = Math.max(3, terminalRows - 11);
      const max = maxUsefulScroll(allMessagesRef.current, w, budget);
      if (max === 0) return null;
      return next <= 0 ? null : Math.min(next, max);
    });
  }, [terminalWidth, terminalRows]);
  // v3.2.2: new output no longer yanks a paged user back to the tail —
  // paging must survive streaming (each 200ms flush used to reset scroll).
  // The window recomputes by itself; scroll resets only explicitly:
  // esc exits the pager (onCancel), and /new, /resume and sends below.

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
      confirmResolveRef.current = (v) => {
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
    // Model selector - ignore text input
    if (viewMode === 'model_select') return;

    const result = handleCommand(input);

    if (result.handled) {
      if (result.action === 'model_select') {
        setViewMode('model_select');
        return;
      }

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
        setScroll(null);
      }

      if (result.action === 'reinit') {
        setViewMode('init_wizard');
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
        setScroll(null);
        const model = file.model ? `（模型: ${file.model}）` : '';
        addMsg(`✓ 已恢复会话 ${summary.id.slice(0, 24)}…，共 ${visible.length} 条可见消息${model}。输入 /模型 <名称> 可切换模型。`);
      }

      return;
    }

    sendMessage(input);
    setScroll(null); // a fresh send always jumps back to the live tail
  }, [handleCommand, sendMessage, app, viewMode, addMsg, hydrateMessages, clearMessages]);

  const allMessages = [...systemMessages, ...messages];
  allMessagesRef.current = allMessages;
  const activeSkills = app.skills.listActive().map(s => s.id);
  const splashMode = allMessages.length === 0;
  const cfg = app.config.get();

  // ── v3.2.1: right-hand info column (opencode parity) — plan ABOVE the
  // context panel, both live. Widths reserve room for the divider.
  const PANEL_WIDTH = 38;
  const PANEL_RESERVE = PANEL_WIDTH + 3; // divider + padding + gap
  const showContextPanel = terminalWidth >= 100;
  // v3.2.2 viewport: the workspace shows a line-budgeted WINDOW of the
  // conversation (alt buffer has no scrollback — the frame is all there
  // is). scroll=null = live tail, >0 = pager looking back. The bottom
  // reserve is MEASURED, not guessed: UserInput reports its real row count
  // (multiline paste + completion popup included); modal prompts use their
  // capped worst case. An under-estimate pushes the frame past the
  // viewport → Ink full-clears → the 发送黑屏 this design exists to kill.
  // Ink 7.1 on Windows also full-clears when the frame is exactly the
  // viewport height, so the frame is rows-1 (FRAME_ROWS) — never rows.
  const [inputRows, setInputRows] = useState(6);
  const modalRows = confirmReq ? 17 : planApproval ? 7 : 0; // capped worst cases
  const bottomReserve = modalRows > 0 ? modalRows
    : inputRows + (isThinking ? 1 : 0) + (queuedMessage ? 1 : 0)
      + (app.permissionMode !== 'ask' ? 1 : 0) // mode badge line
      + (showContextPanel ? 0 : 10);           // PlanPanel fallback below the row
  const workspaceRows = Math.max(3, terminalRows - 1 - bottomReserve);
  const chatWidth = terminalWidth - 4 - (showContextPanel ? PANEL_RESERVE : 0);
  // v3.3.0: the live streaming block shares the workspace budget — it is
  // capped (tail-clipped) so a long answer can never push the frame past
  // the viewport.
  const STREAM_CAP = Math.min(14, Math.max(4, workspaceRows - 3));
  const streamView = streamingView
    ? clipContentToRows(streamingView, chatWidth, STREAM_CAP)
    : null;
  const streamEst = streamView ? estimateMsgLines({ role: 'assistant', content: streamView }, chatWidth) : 0;
  const windowHeaderRows = scroll !== null ? 1 : 0;
  const win = buildWindow(allMessages, scroll, chatWidth, workspaceRows - windowHeaderRows - 1 - streamEst);
  const maxScroll = maxUsefulScroll(allMessages, chatWidth, workspaceRows - 2);
  const contextBreakdown = useMemo(() => {
    try {
      const bd = app.prompts.estimateBreakdown();
      let msgTokens = 0;
      for (const m of app.session.getMessages()) {
        // v3.2.1 fix: the session stores the SYSTEM message too — counting
        // it here double-counted the prompt (消息 showed an inflated 45%).
        if ((m as { role?: string }).role === 'system') continue;
        const c = (m as { content?: unknown }).content;
        msgTokens += estimateTokens(typeof c === 'string' ? c : JSON.stringify(c ?? '')) + 4;
      }
      return { ...bd, msgTokens };
    } catch { return null; }
  }, [app, allMessages.length, app.permissionMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const contextPanel = showContextPanel && contextBreakdown ? (() => {
    const estSum = contextBreakdown.systemPrompt + contextBreakdown.systemTools
      + contextBreakdown.mcpTools + contextBreakdown.skills + contextBreakdown.msgTokens;
    const used = app.sessionStats.promptTokens > 0 ? app.sessionStats.promptTokens : estSum + 64;
    return (
      <ContextPanel
        used={used}
        window={app.getContextWindow()}
        hitRate={cacheSnapshot.totalRequests > 0 ? cacheSnapshot.hitRate : null}
        inTokens={cacheSnapshot.totalInputTokens}
        outTokens={cacheSnapshot.totalOutputTokens}
        width={PANEL_WIDTH}
        categories={[
          { label: '系统工具', tokens: contextBreakdown.systemTools },
          { label: '消息', tokens: contextBreakdown.msgTokens },
          { label: '技能', tokens: contextBreakdown.skills },
          { label: '系统提示词', tokens: contextBreakdown.systemPrompt },
          { label: 'MCP 工具', tokens: contextBreakdown.mcpTools },
        ]}
      />
    );
  })() : null;

  // v3.0.18: no dynamic header/status live in the chat frame (the window
  // above is the transcript). v3.0.11: chat mode input spans the full
  // terminal width (opencode session view); splash keeps the centered
  // fixed-width block.
  const inputArea = confirmReq ? (
    <ConfirmPrompt message={confirmReq.message} onAnswer={onConfirmAnswer} />
  ) : planApproval ? (
    <PlanApproval onAnswer={onPlanApproval} />
  ) : (
    // v3.4.2: the model_select / init_wizard branches here were dead code —
    // both modes early-return the full-screen dialog below and never reach
    // the input slot. Only the real input renders here now.
    <UserInput
      onSubmit={onSubmit}
      // v3.2.2: UserInput only routes esc here when the input is EMPTY and
      // no completion popup is open — clearing typed text must not abort a
      // running turn. esc with the pager open exits the pager only.
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

  // v3.0.15 (borrowed from opencode ui/dialog.tsx): /models opens as a
  // full-screen centered modal overlay, not squeezed into the input slot.
  // The dialog floats in the middle of the terminal with blank space around
  // it (opencode centers horizontally + offsets vertically from the top).
  // v3.2.2: model_select and init_wizard join this full-screen treatment —
  // ModelSelector (13+ rows) and the wizard blew the fixed bottom reserve
  // and pushed the frame past the viewport.
  if (viewMode === 'model_settings' || viewMode === 'model_select' || viewMode === 'init_wizard') {
    // A pending permission confirm must win over any dialog — rendering it
    // here would swallow the prompt (the tool call would hang until the 60s
    // timeout with nothing on screen). Same full-screen centered container.
    if (confirmReq) {
      return (
        <Box flexDirection="column" height={terminalRows - 1} width={terminalWidth} justifyContent="center" alignItems="center">
          <ConfirmPrompt message={confirmReq.message} onAnswer={onConfirmAnswer} />
        </Box>
      );
    }
    if (viewMode === 'model_select') {
      return (
        <Box flexDirection="column" height={terminalRows - 1} width={terminalWidth} justifyContent="center" alignItems="center">
          <ModelSelector
            currentModel={cfg.model}
            currentProvider={cfg.provider}
            customModels={cfg.customModels}
            onSelect={(model) => {
              // switchModel saves, records provider-tagged history and hot-reloads.
              void app.switchModel(model).then(() => {
                setViewMode('chat');
                addMsg(`模型已切换: ${model}`);
                setResolvedTtl(null);
              });
            }}
            onAddNew={() => setViewMode('init_wizard')}
            onCancel={() => setViewMode('chat')}
          />
        </Box>
      );
    }
    if (viewMode === 'init_wizard') {
      return (
        <Box flexDirection="column" height={terminalRows - 1} width={terminalWidth} justifyContent="center" alignItems="center">
          <InitWizard
            onComplete={({ provider, model, apiKey, baseUrl, cache }) => {
              // v3.4.2: ONE write through ConfigManager (merge-preserving,
              // atomic) — the wizard no longer writes config.json itself, so
              // the cache choice can no longer be rolled back by a second
              // save nor wipe modelSettings/customModels/browserSetup.
              void (async () => {
                await app.config.save({
                  provider, model, apiKey, baseUrl,
                  cache: { ...cache, strategy: 'auto' },
                });
                await app.reloadModel();
                setResolvedTtl(null);
                setViewMode('chat');
                addMsg(`配置完成: ${provider} / ${model}${app.usingBuiltinModel ? '（内置共享模型）' : ''}`);
              })();
            }}
            onCancel={() => setViewMode('chat')}
          />
        </Box>
      );
    }
    return (
      <Box flexDirection="column" height={terminalRows - 1} width={terminalWidth} justifyContent="center" alignItems="center">
        <ModelSettings app={app} onClose={() => setViewMode('chat')} width={Math.min(terminalWidth - 2, 72)} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={terminalWidth} paddingX={1} height={terminalRows - 1}>
      {splashMode ? (
        <>
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
          {/* v3.2.2 viewport workspace: a line-budgeted WINDOW of the
              conversation renders inside the alt-screen frame. scroll
              state (wheel/↑/↓) moves the window back; new output snaps
              the window to the live tail. */}
          <Box flexDirection="row" flexGrow={1} minHeight={0}>
            <Box flexDirection="column" flexGrow={1} minWidth={0} paddingLeft={1}>
              {scroll !== null && (
                <Text color={theme.textFaint}>
                  ── 翻页 {Math.min(scroll, maxScroll)}/{maxScroll} · ↑ 更早 · ↓ 返回 · esc 退出 ──
                </Text>
              )}
              {win.messages.map((m, i) => (
                <ChatMessage key={`${win.start + i}-${m.role}-${m.content.slice(0, 8)}`} message={m} width={chatWidth} />
              ))}
              {streamView && (
                <Box flexDirection="column" marginBottom={1}>
                  <Text color={theme.textFaint}>
                    ▪ {app.permissionMode === 'plan' ? 'Plan' : app.permissionMode === 'accept' ? 'YOLO' : 'Build'}{cfg.model ? ` · ${cfg.model}` : ''}
                  </Text>
                  <Markdown content={streamView} width={chatWidth} />
                </Box>
              )}
            </Box>
            {contextPanel && (
              <Box flexDirection="column" flexShrink={0} borderLeft borderStyle="single" borderColor={theme.border} paddingLeft={2}>
                <PlanPanel width={PANEL_WIDTH} />
                <Box marginTop={1}>{contextPanel}</Box>
              </Box>
            )}
          </Box>
          {!contextPanel && <PlanPanel width={terminalWidth - 4} />}
          <Thinking active={isThinking} />
          {queuedMessage && (
            <Box paddingLeft={1}>
              <Text color={theme.warning}>📎 已排队: </Text>
              <Text color={theme.textDim}>{queuedMessage}</Text>
            </Box>
          )}
          {modeBadge}
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

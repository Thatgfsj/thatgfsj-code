/** @jsxImportSource react */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useStdout } from 'ink';
import { Header } from './components/Header.js';
import { ChatList } from './components/ChatList.js';
import { Thinking } from './components/Thinking.js';
import { UserInput } from './components/UserInput.js';
import { StatusBar } from './components/StatusBar.js';
import { ModelSelector } from './components/ModelSelector.js';
import { InitWizard } from './components/InitWizard.js';
import { ModelSettings } from './components/ModelSettings.js';
import { ConfirmPrompt } from './components/ConfirmPrompt.js';
import { Splash } from './components/Splash.js';
import { useChat } from './hooks/useChat.js';
import { useCommands } from './hooks/useCommands.js';
import type { App, ConfirmRequest } from '../app/index.js';
import { SessionManager } from '../session/index.js';
import type { MessageData } from './components/ChatMessage.js';
import { theme } from './theme.js';
import { getVersion } from '../version.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface Props {
  app: App;
}

function saveModelToHistory(model: string) {
  const dir = join(homedir(), '.thatgfsj');
  const path = join(dir, 'models.json');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  let history: string[] = [];
  if (existsSync(path)) {
    try { history = JSON.parse(readFileSync(path, 'utf-8')); } catch {}
  }
  if (!history.includes(model)) {
    history.push(model);
    writeFileSync(path, JSON.stringify(history, null, 2));
  }
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
  const { messages, isThinking, streaming, streamingToolCalls, queuedMessage, sendMessage, cancel, hydrateMessages } = useChat(app);
  const { handleCommand } = useCommands(app);
  const [systemMessages, setSystemMessages] = useState<MessageData[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;
  const terminalRows = (stdout as any)?.rows || 30;
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

  const addMsg = useCallback((content: string) => {
    setSystemMessages(prev => [...prev, { role: 'assistant', content }]);
  }, []);

  // ── v3.0.5: permission prompt wiring ──────────────────────
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const confirmResolveRef = useRef<((v: { allowed: boolean; always: boolean }) => void) | null>(null);

  useEffect(() => {
    app.confirmHandler = (req) => new Promise<boolean>((resolve) => {
      setConfirmReq(req);
      const timer = setTimeout(() => {
        confirmResolveRef.current?.({ allowed: false, always: false });
      }, 60000);
      timer.unref?.();
      confirmResolveRef.current = (v) => {
        clearTimeout(timer);
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
    return () => {
      app.confirmHandler = undefined;
    };
  }, [app]);

  const onConfirmAnswer = useCallback((allowed: boolean, always: boolean) => {
    confirmResolveRef.current?.({ allowed, always });
  }, []);

  const onSubmit = useCallback(async (input: string) => {
    // Model selector - ignore text input
    if (viewMode === 'model_select') return;

    const result = handleCommand(input);

    if (result.handled) {
      if (input.trim() === '/模型' || input.trim() === '/model') {
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

      if (result.action === 'clear') setSystemMessages([]);

      if (result.action === 'reinit') {
        setViewMode('init_wizard');
      }

      if (result.action === 'reload_model') {
        await app.reloadModel();
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
        const visible: MessageData[] = file.messages
          .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));
        setSystemMessages([]);
        hydrateMessages(visible);
        const model = file.model ? `（模型: ${file.model}）` : '';
        addMsg(`✓ 已恢复会话 ${summary.id.slice(0, 24)}…，共 ${visible.length} 条可见消息${model}。输入 /模型 <名称> 可切换模型。`);
      }

      return;
    }

    sendMessage(input);
  }, [handleCommand, sendMessage, app, viewMode, addMsg, hydrateMessages]);

  const allMessages = [...systemMessages, ...messages];
  const activeSkills = app.skills.listActive().map(s => s.id);
  const splashMode = allMessages.length === 0;
  const cfg = app.config.get();
  // v3.0.11: chat mode input spans the full terminal width (opencode
  // session view); splash keeps the centered fixed-width block.
  const inputArea = confirmReq ? (
    <ConfirmPrompt message={confirmReq.message} onAnswer={onConfirmAnswer} />
  ) : viewMode === 'model_settings' ? (
    <ModelSettings app={app} onClose={() => setViewMode('chat')} width={splashMode ? Math.min(terminalWidth - 4, 64) : terminalWidth - 2} />
  ) : viewMode === 'model_select' ? (
    <ModelSelector
      currentModel={cfg.model}
      currentProvider={cfg.provider}
      onSelect={(model) => {
        app.config.save({ model });
        saveModelToHistory(model);
        void app.reloadModel().then(() => setResolvedTtl(null));
        setViewMode('chat');
        addMsg(`模型已切换: ${model}`);
      }}
      onAddNew={() => setViewMode('init_wizard')}
    />
  ) : viewMode === 'init_wizard' ? (
    <InitWizard
      onComplete={(provider, model, apiKey, baseUrl) => {
        app.config.save({ provider, model, apiKey, baseUrl });
        saveModelToHistory(model);
        setViewMode('chat');
        addMsg(`配置完成: ${provider} / ${model}`);
      }}
      onCancel={() => setViewMode('chat')}
    />
  ) : (
    <UserInput
      onSubmit={onSubmit}
      onCancel={cancel}
      disabled={false}
      mode="Build"
      provider={cfg.provider}
      model={cfg.model}
      thinking={thinking}
      fullWidth={!splashMode}
      width={splashMode ? Math.min(terminalWidth - 4, 64) : undefined}
    />
  );

  return (
    <Box flexDirection="column" width={terminalWidth} paddingX={1} {...(splashMode ? { height: terminalRows } : {})}>
      {splashMode ? (
        <>
          <Splash />
          <Box justifyContent="center">{inputArea}</Box>
          <Box justifyContent="center" paddingTop={1}>
            <Text color={theme.textFaint}>
              <Text color={theme.accent}>◆ Tip </Text>
              {' '}/models 可添加模型、设置上下文长度和思考强度 · /help 查看全部命令
            </Text>
          </Box>
        </>
      ) : (
        <>
          <Header
            cacheHitRate={cacheSnapshot.hitRate > 0 ? cacheSnapshot.hitRate : null}
            cacheSavingsCNY={cacheSnapshot.estimatedSavingsCNY}
            cacheTtl={resolvedTtl ?? configTtl ?? null}
            width={terminalWidth}
          />
          <ChatList
            messages={allMessages}
            streaming={streaming}
            streamingToolCalls={streamingToolCalls}
            width={terminalWidth - 4}
            mode="Build"
            model={cfg.model}
          />
          <Thinking active={isThinking} />
          {queuedMessage && (
            <Box paddingLeft={1}>
              <Text color={theme.warning}>📎 已排队: </Text>
              <Text color={theme.textDim}>{queuedMessage}</Text>
            </Box>
          )}
          {inputArea}
        </>
      )}
      <StatusBar
        messageCount={allMessages.length}
        skills={activeSkills}
        provider={cfg.provider}
        model={cfg.model}
        stats={{
          contextTokens: app.sessionStats.promptTokens,
          contextWindow: app.getContextWindow(),
          inTokens: cacheSnapshot.totalInputTokens,
          outTokens: app.sessionStats.completionTokens,
          savingsCNY: cacheSnapshot.estimatedSavingsCNY,
        }}
      />
      <Box justifyContent="space-between" width="100%">
        <Text color={theme.textFaint}>~</Text>
        <Text color={theme.textFaint}>v{getVersion()}{app.permissionMode === 'accept' ? ' · yolo' : ''}</Text>
      </Box>
    </Box>
  );
}

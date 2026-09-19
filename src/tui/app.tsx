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
import { ConfirmPrompt } from './components/ConfirmPrompt.js';
import { useChat } from './hooks/useChat.js';
import { useCommands } from './hooks/useCommands.js';
import type { App, ConfirmRequest } from '../app/index.js';
import { SessionManager } from '../session/index.js';
import type { MessageData } from './components/ChatMessage.js';
import { theme } from './theme.js';
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

type ViewMode = 'chat' | 'model_select' | 'init_wizard';

export function TuiApp({ app }: Props) {
  const { messages, isThinking, streaming, streamingToolCalls, queuedMessage, sendMessage, cancel, hydrateMessages } = useChat(app);
  const { handleCommand } = useCommands(app);
  const [systemMessages, setSystemMessages] = useState<MessageData[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;

  // v3.0.0: cache stats snapshot for the Header.
  const [cacheSnapshot, setCacheSnapshot] = useState(() => app.cacheStats.snapshot());
  // v3.0.3: resolved TTL (sticky per session). null until first round.
  const [resolvedTtl, setResolvedTtl] = useState<'5m' | '1h' | null>(app.resolvedTtl);
  const configTtl = (app.config.get() as any).cache?.ttl as 'auto' | '5m' | '1h' | undefined;
  useEffect(() => {
    setCacheSnapshot(app.cacheStats.snapshot());
    setResolvedTtl(app.resolvedTtl);
  }, [messages.length]);

  const addMsg = useCallback((content: string) => {
    setSystemMessages(prev => [...prev, { role: 'assistant', content }]);
  }, []);

  // ── v3.0.5: permission prompt wiring ──────────────────────
  // The pending confirmation is held in React state and rendered INSTEAD of
  // UserInput, so keystrokes can not double-feed into the chat box while a
  // tool asks for permission. App.requestConfirmation resolves through this.
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const confirmResolveRef = useRef<((v: { allowed: boolean; always: boolean }) => void) | null>(null);

  useEffect(() => {
    app.confirmHandler = (req) => new Promise<boolean>((resolve) => {
      setConfirmReq(req);
      // v3.0.5 fix: dismiss the prompt UI itself on timeout — App's side of
      // the race resolves the permission answer, this resolves the rendering.
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
    // Route auto-compact notices into the chat area instead of stderr.
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

    // Normal command handling
    const result = handleCommand(input);

    if (result.handled) {
      if (input.trim() === '/模型' || input.trim() === '/model') {
        setViewMode('model_select');
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

      // v3.0.5: /model — hot-swap provider+model now.
      if (result.action === 'reload_model') {
        await app.reloadModel();
        setResolvedTtl(null);
      }

      // v3.0.5: /ttl — apply immediately.
      if (result.action === 'apply_ttl' && result.payload) {
        await app.applyTtl(result.payload as '5m' | '1h');
        setResolvedTtl(result.payload);
      }

      // v3.0.5: /resume <n> — load the session file and hydrate the chat list.
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

  return (
    <Box flexDirection="column" paddingX={1}>
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
      />
      <Thinking active={isThinking} />
      {queuedMessage && (
        <Box paddingLeft={1}>
          <Text color={theme.warning}>📎 已排队: </Text>
          <Text color={theme.textDim}>{queuedMessage}</Text>
        </Box>
      )}
      {viewMode === 'model_select' ? (
        <ModelSelector
          currentModel={app.config.get().model}
          currentProvider={app.config.get().provider}
          onSelect={(model) => {
            // v3.0.5: fire-and-forget hot reload — the selector returns to
            // chat immediately, the provider swap lands a moment later.
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
      ) : confirmReq ? (
        // v3.0.5: exclusive input ownership while a tool asks for permission.
        <ConfirmPrompt message={confirmReq.message} onAnswer={onConfirmAnswer} />
      ) : (
        <Box flexDirection="column">
          <UserInput onSubmit={onSubmit} onCancel={cancel} disabled={false} />
        </Box>
      )}
      <StatusBar
        messageCount={allMessages.length}
        skills={activeSkills}
        provider={app.config.get().provider}
        model={app.config.get().model}
      />
    </Box>
  );
}

/** @jsxImportSource react */
import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import { Header } from './components/Header.js';
import { ChatList } from './components/ChatList.js';
import { Thinking } from './components/Thinking.js';
import { UserInput } from './components/UserInput.js';
import { StatusBar } from './components/StatusBar.js';
import { ModelSelector } from './components/ModelSelector.js';
import { InitWizard } from './components/InitWizard.js';
import { useChat } from './hooks/useChat.js';
import { useCommands } from './hooks/useCommands.js';
import type { App } from '../app/index.js';
import type { MessageData } from './components/ChatMessage.js';
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
  const { messages, isThinking, streaming, streamingToolCalls, queuedMessage, sendMessage, cancel } = useChat(app);
  const { handleCommand } = useCommands(app);
  const [systemMessages, setSystemMessages] = useState<MessageData[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;

  // v3.0.0: cache stats snapshot for the Header. Re-read whenever messages
  // change (i.e. a round just completed and recorded new usage). Polling on
  // an interval would be wasteful; React re-render is the trigger.
  const [cacheSnapshot, setCacheSnapshot] = useState(() => app.cacheStats.snapshot());
  // v3.0.3: resolved TTL (sticky per session). null until first round.
  const [resolvedTtl, setResolvedTtl] = useState<'5m' | '1h' | null>(app.resolvedTtl);
  // The user-pinned config TTL ('auto' | '5m' | '1h') — used to render the
  // Header chip BEFORE the first round, when resolvedTtl is still null.
  const configTtl = (app.config.get() as any).cache?.ttl as 'auto' | '5m' | '1h' | undefined;
  useEffect(() => {
    setCacheSnapshot(app.cacheStats.snapshot());
    setResolvedTtl(app.resolvedTtl);
  }, [messages.length]);

  const addMsg = useCallback((content: string) => {
    setSystemMessages(prev => [...prev, { role: 'assistant', content }]);
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

      return;
    }

    sendMessage(input);
  }, [handleCommand, sendMessage, app, viewMode, addMsg]);

  const allMessages = [...systemMessages, ...messages];
  const activeSkills = app.skills.listActive().map(s => s.id);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header
        provider={app.config.get().provider}
        model={app.config.get().model}
        cacheHitRate={cacheSnapshot.hitRate > 0 ? cacheSnapshot.hitRate : null}
        cacheSavingsCNY={cacheSnapshot.estimatedSavingsCNY}
        cacheTtl={resolvedTtl ?? configTtl ?? null}
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
          <Text color="#F59E0B">📎 已排队: </Text>
          <Text color="#94A3B8">{queuedMessage}</Text>
        </Box>
      )}
      {viewMode === 'model_select' ? (
        <ModelSelector
          currentModel={app.config.get().model}
          currentProvider={app.config.get().provider}
          onSelect={(model) => {
            app.config.save({ model });
            saveModelToHistory(model);
            setViewMode('chat');
            addMsg(`模型已切换: ${model}`);
          }}
          onAddNew={() => setViewMode('init_wizard')}
        />
      ) : viewMode === 'init_wizard' ? (
        // v3.0.1: InitWizard is now fully self-contained — it owns its own
        // input handling via useInput + ink-text-input. No external UserInput
        // is rendered here, and app.tsx no longer has the text-entry
        // viewModes (init_key / init_url / init_custom_model) because they
        // were the broken input-handling path that left users stuck on a
        // frozen "输入 API Key" screen with no way to type.
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
        <Box flexDirection="column">
          <UserInput onSubmit={onSubmit} onCancel={cancel} disabled={false} />
        </Box>
      )}
      <StatusBar messageCount={allMessages.length} skills={activeSkills} />
    </Box>
  );
}

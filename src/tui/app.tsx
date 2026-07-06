/** @jsxImportSource react */
import React, { useState, useCallback } from 'react';
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
import type { ProviderName } from '../config/types.js';
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

type ViewMode = 'chat' | 'model_select' | 'init_wizard' | 'init_key' | 'init_url' | 'init_custom_model';

export function TuiApp({ app }: Props) {
  const { messages, isThinking, streaming, streamingToolCalls, queuedMessage, sendMessage, cancel } = useChat(app);
  const { handleCommand } = useCommands(app);
  const [systemMessages, setSystemMessages] = useState<MessageData[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [initProvider, setInitProvider] = useState<ProviderName>('siliconflow');
  const [initUrl, setInitUrl] = useState('');
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;

  const addMsg = useCallback((content: string) => {
    setSystemMessages(prev => [...prev, { role: 'assistant', content }]);
  }, []);

  const onSubmit = useCallback(async (input: string) => {
    // Init wizard - API Key input
    if (viewMode === 'init_key') {
      const key = input.trim();
      if (!key) { setViewMode('chat'); return; }
      // Save and complete
      const { App: AppClass } = await import('../app/index.js');
      const cfg = app.config.get();
      app.config.save({ provider: initProvider, apiKey: key, model: cfg.model || 'default' });
      saveModelToHistory(cfg.model || 'default');
      setViewMode('chat');
      addMsg(`配置已更新: ${initProvider}`);
      return;
    }

    // Init wizard - Custom URL input
    if (viewMode === 'init_url') {
      const url = input.trim();
      if (!url) { setViewMode('chat'); return; }
      setInitUrl(url);
      setViewMode('init_key');
      return;
    }

    // Init wizard - Custom model name
    if (viewMode === 'init_custom_model') {
      const model = input.trim();
      if (model) {
        app.config.save({ model });
        saveModelToHistory(model);
        addMsg(`模型已切换: ${model}`);
      }
      setViewMode('chat');
      return;
    }

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
  }, [handleCommand, sendMessage, app, viewMode, initProvider, initUrl, addMsg]);

  const allMessages = [...systemMessages, ...messages];
  const activeSkills = app.skills.listActive().map(s => s.id);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header provider={app.config.get().provider} model={app.config.get().model} />
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
          onSelect={(model) => {
            app.config.save({ model });
            saveModelToHistory(model);
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
        <Box flexDirection="column">
          {viewMode === 'init_key' && (
            <Box paddingLeft={1} marginBottom={0}>
              <Text color="#06B6D4" bold>输入 API Key: </Text>
              <Text dimColor>({initProvider})</Text>
            </Box>
          )}
          {viewMode === 'init_url' && (
            <Box paddingLeft={1} marginBottom={0}>
              <Text color="#06B6D4" bold>输入中转站 URL: </Text>
            </Box>
          )}
          {viewMode === 'init_custom_model' && (
            <Box paddingLeft={1} marginBottom={0}>
              <Text color="#06B6D4" bold>输入模型名称: </Text>
            </Box>
          )}
          <UserInput onSubmit={onSubmit} onCancel={cancel} disabled={false} />
        </Box>
      )}
      <StatusBar messageCount={allMessages.length} skills={activeSkills} />
    </Box>
  );
}

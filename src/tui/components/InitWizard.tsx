/** @jsxImportSource react */
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { listProviders, getModelsForProvider, isCustomProvider } from '../../config/providers.js';
import type { ProviderName } from '../../config/types.js';

interface Props {
  onComplete: (provider: ProviderName, model: string, apiKey: string, baseUrl?: string) => void;
  onCancel: () => void;
}

type InitStep = 'provider' | 'api_key' | 'model' | 'custom_model' | 'custom_url';

export function InitWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState<InitStep>('provider');
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>('siliconflow');
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [customUrl, setCustomUrl] = useState('');

  const providers = listProviders();
  const models = getModelsForProvider(selectedProvider);

  const saveConfig = (provider: ProviderName, model: string, key: string, url?: string) => {
    const dir = join(homedir(), '.thatgfsj');
    const configPath = join(dir, 'config.json');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const config: Record<string, any> = { provider, model, apiKey: key, temperature: 0.7, maxTokens: 4096, contextLength: 50 };
    if (url) config.baseUrl = url;
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Save to models history
    const historyPath = join(dir, 'models.json');
    let history: string[] = [];
    if (existsSync(historyPath)) {
      try { history = JSON.parse(readFileSync(historyPath, 'utf-8')); } catch {}
    }
    if (!history.includes(model)) {
      history.push(model);
      writeFileSync(historyPath, JSON.stringify(history, null, 2));
    }
  };

  // Step 1: Provider selection
  if (step === 'provider') {
    const items = providers.map(p => ({ label: p.name, value: p.key }));
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="#06B6D4" bold>选择服务商 (↑↓ 回车):</Text>
        <SelectInput
          items={items}
          onSelect={(item) => {
            setSelectedProvider(item.value as ProviderName);
            if (isCustomProvider(item.value as ProviderName)) {
              setStep('custom_url');
            } else {
              setStep('api_key');
            }
          }}
        />
      </Box>
    );
  }

  // Custom URL input
  if (step === 'custom_url') {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="#06B6D4" bold>输入中转站 URL:</Text>
        <Text dimColor>例如: https://api.example.com/v1</Text>
        <Text color="#F59E0B">（请直接输入 URL 并回车）</Text>
      </Box>
    );
  }

  // Step 2: API Key
  if (step === 'api_key') {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="#06B6D4" bold>输入 API Key:</Text>
        <Text dimColor>服务商: {providers.find(p => p.key === selectedProvider)?.name}</Text>
        <Text color="#F59E0B">（请直接输入 Key 并回车）</Text>
      </Box>
    );
  }

  // Step 3: Model selection
  if (step === 'model') {
    const items = [
      ...models.map(m => ({ label: `${m.name} - ${m.desc}`, value: m.id })),
      { label: '＋ 输入自定义模型名', value: '__custom__' },
    ];
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="#06B6D4" bold>选择模型 (↑↓ 回车):</Text>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === '__custom__') {
              setStep('custom_model');
            } else {
              setSelectedModel(item.value);
              saveConfig(selectedProvider, item.value, apiKey, customUrl || undefined);
              onComplete(selectedProvider, item.value, apiKey, customUrl || undefined);
            }
          }}
        />
      </Box>
    );
  }

  // Custom model name
  if (step === 'custom_model') {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="#06B6D4" bold>输入模型名称:</Text>
        <Text color="#F59E0B">（请直接输入模型名并回车）</Text>
      </Box>
    );
  }

  return null;
}

// Export steps for external handling
export type { InitStep };
export { isCustomProvider };

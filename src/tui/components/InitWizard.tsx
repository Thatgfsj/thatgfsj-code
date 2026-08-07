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

type InitStep =
  | 'provider'
  | 'api_key'
  | 'model'
  | 'custom_model'
  | 'custom_url'
  | 'cache_strategy'
  | 'cache_ttl';

interface CacheChoice {
  enabled: boolean;
  ttl: '5m' | '1h';
}

/**
 * v3.0.0: InitWizard gained two new steps after model selection:
 *   - cache_strategy: enable / disable prompt caching
 *   - cache_ttl:      5m vs 1h (only if enabled)
 *
 * The defaults mirror ConfigManager.DEFAULT_CONFIG (enabled, 5m). Users on
 * OpenAI / DeepSeek / Gemini can ignore these — those providers do
 * automatic caching and the flag is purely advisory there. The flag
 * matters for Anthropic users who want to opt out of cache_control
 * markers or pick a longer TTL.
 */
export function InitWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState<InitStep>('provider');
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>('siliconflow');
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [cacheChoice, setCacheChoice] = useState<CacheChoice>({ enabled: true, ttl: '5m' });

  const providers = listProviders();
  const models = getModelsForProvider(selectedProvider);

  const saveConfig = (provider: ProviderName, model: string, key: string, url?: string) => {
    const dir = join(homedir(), '.thatgfsj');
    const configPath = join(dir, 'config.json');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const config: Record<string, any> = {
      provider,
      model,
      apiKey: key,
      temperature: 0.7,
      maxTokens: 4096,
      contextLength: 50,
      // v3.0.0: cache policy from wizard
      cache: {
        enabled: cacheChoice.enabled,
        ttl: cacheChoice.ttl,
        strategy: 'auto',
      },
    };
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
              // v3.0.0: prompt the user for cache strategy after model.
              setStep('cache_strategy');
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

  // v3.0.0: prompt-cache strategy step
  if (step === 'cache_strategy') {
    const items = [
      { label: '✓ 开启（推荐，节省 token 成本）', value: 'on' },
      { label: '✗ 关闭（每次请求都重新计算）', value: 'off' },
    ];
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="#06B6D4" bold>是否开启 Prompt Caching?</Text>
        <Text dimColor>对 Anthropic / DeepSeek / Gemini 有效，OpenAI 兼容接口默认自动缓存。</Text>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === 'on') {
              setCacheChoice(c => ({ ...c, enabled: true }));
              setStep('cache_ttl');
            } else {
              setCacheChoice(c => ({ ...c, enabled: false }));
              saveConfig(selectedProvider, selectedModel, apiKey, customUrl || undefined);
              onComplete(selectedProvider, selectedModel, apiKey, customUrl || undefined);
            }
          }}
        />
      </Box>
    );
  }

  // v3.0.0: TTL choice
  if (step === 'cache_ttl') {
    const items = [
      { label: '5 分钟（写入成本低，适合短会话）', value: '5m' },
      { label: '1 小时（写入成本高，适合长会话）', value: '1h' },
    ];
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="#06B6D4" bold>Cache TTL:</Text>
        <SelectInput
          items={items}
          onSelect={(item) => {
            setCacheChoice(c => ({ ...c, ttl: item.value as '5m' | '1h' }));
            saveConfig(selectedProvider, selectedModel, apiKey, customUrl || undefined);
            onComplete(selectedProvider, selectedModel, apiKey, customUrl || undefined);
          }}
        />
      </Box>
    );
  }

  return null;
}

// Export steps for external handling
export type { InitStep };
export { isCustomProvider };

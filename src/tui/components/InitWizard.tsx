/** @jsxImportSource react */
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { listProviders, getModelsForProvider, isCustomProvider, PROVIDERS } from '../../config/providers.js';
import type { ProviderName } from '../../config/types.js';

export interface WizardResult {
  provider: ProviderName;
  model: string;
  apiKey: string;
  baseUrl?: string;
  cache: { enabled: boolean; ttl: '5m' | '1h' };
}

interface Props {
  onComplete: (result: WizardResult) => void;
  onCancel: () => void;
}

type InitStep = 'provider' | 'custom_url' | 'api_key' | 'model' | 'custom_model' | 'cache_strategy';

/**
 * v3.4.2 rewrite of the "patches on patches" wizard:
 *  - NO raw config.json writes. The wizard only collects state and hands a
 *    single WizardResult to onComplete; the host saves through
 *    ConfigManager (atomic, merge-preserving). The old saveConfig() wiped
 *    modelSettings/customModels/browserSetup and the follow-up
 *    app.config.save() then silently rolled back the user's cache choice.
 *  - ESC cancels from EVERY step (select steps included) — previously the
 *    provider/model/cache steps had no way out except Ctrl+C.
 *  - Keyless providers (Ollama) skip the API-key step entirely instead of
 *    forcing a dummy key.
 */
export function InitWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState<InitStep>('provider');
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>('siliconflow');
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [cacheChoice, setCacheChoice] = useState<{ enabled: boolean; ttl: '5m' | '1h' }>({ enabled: true, ttl: '1h' });

  const providers = listProviders();
  const models = getModelsForProvider(selectedProvider);
  const needsKey = !PROVIDERS[selectedProvider]?.keyless;

  // ESC cancels from any step. ink-select-input never consumes escape, and
  // ink-text-input doesn't either, so this fires everywhere.
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  const finish = (model: string, cache: { enabled: boolean; ttl: '5m' | '1h' }) => {
    onComplete({
      provider: selectedProvider,
      model,
      apiKey: needsKey ? apiKey : '',
      baseUrl: customUrl || undefined,
      cache,
    });
  };

  // Step 1: Provider selection
  if (step === 'provider') {
    const items = providers.map(p => ({ label: p.name, value: p.key }));
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="#06B6D4" bold>选择服务商 (↑↓ 回车，esc 取消):</Text>
        <SelectInput
          items={items}
          onSelect={(item) => {
            const provider = item.value as ProviderName;
            setSelectedProvider(provider);
            if (isCustomProvider(provider)) {
              setStep('custom_url');
            } else if (PROVIDERS[provider]?.keyless) {
              setStep('model');
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
        <Text color="#F59E0B">（请直接输入 URL 并回车，ESC 取消）</Text>
        <Box marginTop={1}>
          <Text color="#06B6D4">❯ </Text>
          <TextInput
            value={customUrl}
            onChange={setCustomUrl}
            onSubmit={(value) => {
              if (value.trim()) {
                setCustomUrl(value.trim());
                setStep('api_key');
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  // Step 2: API Key
  if (step === 'api_key') {
    const providerLabel = providers.find(p => p.key === selectedProvider)?.name || selectedProvider;
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="#06B6D4" bold>输入 API Key:</Text>
        <Text dimColor>服务商: {providerLabel}</Text>
        <Text color="#F59E0B">（请直接输入 Key 并回车，ESC 取消）</Text>
        <Box marginTop={1}>
          <Text color="#06B6D4">❯ </Text>
          <TextInput
            value={apiKey}
            onChange={setApiKey}
            onSubmit={(value) => {
              if (value.trim()) {
                setApiKey(value.trim());
                setStep('model');
              }
            }}
          />
        </Box>
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
        <Text color="#06B6D4" bold>选择模型 (↑↓ 回车，esc 取消):</Text>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === '__custom__') {
              setStep('custom_model');
            } else {
              setSelectedModel(item.value);
              setStep('cache_strategy');
            }
          }}
        />
      </Box>
    );
  }

  // Custom model name input
  if (step === 'custom_model') {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="#06B6D4" bold>输入模型名称:</Text>
        <Text color="#F59E0B">（请直接输入模型名并回车，ESC 取消）</Text>
        <Box marginTop={1}>
          <Text color="#06B6D4">❯ </Text>
          <TextInput
            value={selectedModel}
            onChange={setSelectedModel}
            onSubmit={(value) => {
              if (value.trim()) {
                setSelectedModel(value.trim());
                setStep('cache_strategy');
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  // Step 4: prompt-cache strategy. Default 1h (cannot expire mid-task);
  // 5m is only for sessions the user knows are short.
  if (step === 'cache_strategy') {
    const items = [
      { label: '🕐 1 小时（推荐：默认长任务，缓存不中途失效）', value: '1h' },
      { label: '⏱ 5 分钟（只适合你确认是短会话）', value: '5m' },
      { label: '✗ 关闭（每次请求都重新计算）', value: 'off' },
    ];
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="#06B6D4" bold>Prompt Caching 策略 (esc 取消):</Text>
        <Text dimColor>对 Anthropic / DeepSeek / Gemini 有效。</Text>
        <Text dimColor>推荐 1 小时：任务开始前无法预知长度，5 分钟 TTL 会在长任务中途过期。</Text>
        <SelectInput
          items={items}
          onSelect={(item) => {
            const choice = item.value === 'off'
              ? { enabled: false, ttl: '1h' as const }
              : { enabled: true, ttl: item.value as '5m' | '1h' };
            setCacheChoice(choice);
            finish(selectedModel, choice);
          }}
        />
      </Box>
    );
  }

  return null;
}

export type { InitStep };
export { isCustomProvider };

/** @jsxImportSource react */
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { listProviders, getModelsForProvider, isCustomProvider } from '../../config/providers.js';
import type { ProviderName } from '../../config/types.js';

interface Props {
  onComplete: (provider: ProviderName, model: string, apiKey: string, baseUrl?: string) => void;
  onCancel: () => void;
}

type InitStep = 'provider' | 'custom_url' | 'api_key' | 'model' | 'custom_model' | 'cache_strategy';

interface CacheChoice {
  enabled: boolean;
  ttl: '5m' | '1h';
}

/**
 * v3.0.1: InitWizard is now fully self-contained — it manages its own
 * step state AND its own keyboard input for text-entry steps (api_key,
 * custom_url, custom_model). The previous version had a fatal bug:
 *
 *   The text-entry steps (`api_key`, `custom_url`, `custom_model`) only
 *   rendered a `<Text>` prompt with no actual input box. The host
 *   component (app.tsx) had its own UserInput BUT only rendered it when
 *   viewMode was NOT 'init_wizard' (see app.tsx ternary). So when the
 *   wizard's internal step advanced to 'api_key', the user could SEE the
 *   "输入 API Key: 服务商: deepseek" prompt but had NO way to type into
 *   it. Ink silently swallowed keystrokes (no useInput handler was
 *   active), and the user was stuck on a frozen screen — exactly the
 *   bug that prompted the user-reported "选择 deepseek 然后退出":
 *   pressing Ctrl+C felt like the only escape.
 *
 * Fix: this file now uses `useInput` and `ink-text-input` for the text
 * steps. The SetViewMode-based input delegation in app.tsx is no longer
 * required for the InitWizard flow.
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
      cache: {
        enabled: cacheChoice.enabled,
        ttl: cacheChoice.ttl,
        strategy: 'auto',
      },
    };
    if (url) config.baseUrl = url;
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  };

  // v3.0.1: ESC cancels the wizard from any text-entry step. This is the
  // hook that the previous version was missing — when the user pressed
  // ESC on the frozen "输入 API Key" screen, nothing happened because no
  // useInput was active. Now it bails out cleanly.
  useInput((_input, key) => {
    if (key.escape && (step === 'api_key' || step === 'custom_url' || step === 'custom_model')) {
      onCancel();
    }
  });

  // Step 1: Provider selection
  if (step === 'provider') {
    const items = providers.map(p => ({ label: p.name, value: p.key }));
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="#06B6D4" bold>选择服务商 (↑↓ 回车):</Text>
        <SelectInput
          items={items}
          onSelect={(item) => {
            const provider = item.value as ProviderName;
            setSelectedProvider(provider);
            if (isCustomProvider(provider)) {
              setStep('custom_url');
            } else {
              setStep('api_key');
            }
          }}
        />
      </Box>
    );
  }

  // Custom URL input — v3.0.1 NOW has a real TextInput
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

  // Step 2: API Key — v3.0.1 NOW has a real TextInput
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
                if (isCustomProvider(selectedProvider)) {
                  // Custom OpenAI/Anthropic: after key, go to model
                  setStep('model');
                } else {
                  // Standard providers: skip to model selection
                  setStep('model');
                }
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
        <Text color="#06B6D4" bold>选择模型 (↑↓ 回车):</Text>
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

  // Custom model name input — v3.0.1 NOW has a real TextInput
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

  // v3.0.3: prompt-cache strategy step — auto / 5m / 1h / off.
  // The wizard used to require two questions (on/off + 5m/1h). Now it
  // gives the user a single, clear choice up front, with "自动" as the
  // default. The auto path lets the runtime pick the TTL based on the
  // conversation length (see cache/smartModel.ts decideTTL).
  if (step === 'cache_strategy') {
    const items = [
      { label: '🤖 自动（推荐：根据会话长度智能选 5m / 1h）', value: 'auto' },
      { label: '⏱ 强制 5 分钟（短会话，写入便宜）', value: '5m' },
      { label: '🕐 强制 1 小时（长会话，命中率优先）', value: '1h' },
      { label: '✗ 关闭（每次请求都重新计算）', value: 'off' },
    ];
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="#06B6D4" bold>Prompt Caching 策略:</Text>
        <Text dimColor>对 Anthropic / DeepSeek / Gemini 有效。</Text>
        <Text dimColor>自动模式：短会话用 5m（便宜），长会话（&gt;15 轮）自动切 1h。</Text>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === 'off') {
              setCacheChoice({ enabled: false, ttl: '5m' });
            } else if (item.value === 'auto') {
              setCacheChoice({ enabled: true, ttl: '5m' });  // start at 5m, smartModel will upgrade
            } else {
              setCacheChoice({ enabled: true, ttl: item.value as '5m' | '1h' });
            }
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

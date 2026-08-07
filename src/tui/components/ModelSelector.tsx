/** @jsxImportSource react */
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { PROVIDERS, getModelsForProvider } from '../../config/providers.js';
import type { ProviderName } from '../../config/types.js';

interface Props {
  currentModel: string;
  currentProvider?: ProviderName;
  onSelect: (model: string) => void;
  onAddNew: () => void;
}

interface SavedModel {
  label: string;
  value: string;
}

function loadSavedModels(currentProvider?: ProviderName): SavedModel[] {
  const configPath = join(homedir(), '.thatgfsj', 'config.json');
  const models: SavedModel[] = [];
  const seen = new Set<string>();

  // 1. Load from history if exists
  const historyPath = join(homedir(), '.thatgfsj', 'models.json');
  if (existsSync(historyPath)) {
    try {
      const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
      for (const m of history) {
        if (!seen.has(m)) {
          seen.add(m);
          models.push({ label: m, value: m });
        }
      }
    } catch {}
  }

  // 2. Always include current model
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config.model && !seen.has(config.model)) {
        seen.add(config.model);
        models.push({ label: `${config.model} (当前)`, value: config.model });
      }
    } catch {}
  }

  // 3. v3.0.0 bug fix: ALWAYS include the current provider's catalog of
  // models, otherwise users on a custom relay (mimo / one-api / etc.) who
  // only have the current model in history see a list of 1 item and can't
  // switch to deepseek / gpt-4o / etc. without going through init wizard.
  // This is the model_selector "选 deepseek 然后退出" bug: the list only
  // contained the current model, so the user pressed Enter on the wrong
  // item (or thought the list was broken), then Ctrl+C'd out.
  if (currentProvider && PROVIDERS[currentProvider]) {
    const catalog = getModelsForProvider(currentProvider);
    for (const m of catalog) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        models.push({ label: m.id, value: m.id });
      }
    }
  }

  // 4. Universal fallbacks if user is on no history and no catalog
  if (models.length === 0) {
    const defaults = ['deepseek-chat', 'gpt-4o', 'mimo-v2.5-pro'];
    for (const m of defaults) {
      models.push({ label: m, value: m });
    }
  }

  return models;
}

export function ModelSelector({ currentModel, currentProvider, onSelect, onAddNew }: Props) {
  const [items, setItems] = useState<SavedModel[]>([]);

  useEffect(() => {
    const saved = loadSavedModels(currentProvider);
    // Add "add new" option at the end
    saved.push({ label: '＋ 添加新模型', value: '__add_new__' });
    setItems(saved);
  }, [currentProvider]);

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text color="#06B6D4" bold>当前模型: {currentModel}</Text>
      <Text dimColor>选择模型 (↑↓ 回车):</Text>
      <SelectInput
        items={items}
        onSelect={(item) => {
          if (item.value === '__add_new__') {
            onAddNew();
          } else {
            onSelect(item.value);
          }
        }}
      />
    </Box>
  );
}

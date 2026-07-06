/** @jsxImportSource react */
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface Props {
  currentModel: string;
  onSelect: (model: string) => void;
  onAddNew: () => void;
}

interface SavedModel {
  label: string;
  value: string;
}

function loadSavedModels(): SavedModel[] {
  const configPath = join(homedir(), '.thatgfsj', 'config.json');
  const models: SavedModel[] = [];
  const seen = new Set<string>();

  // Load from history if exists
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

  // Always include current model
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config.model && !seen.has(config.model)) {
        seen.add(config.model);
        models.push({ label: `${config.model} (当前)`, value: config.model });
      }
    } catch {}
  }

  // Add some common defaults if list is empty
  if (models.length === 0) {
    const defaults = ['deepseek-chat', 'gpt-4o', 'mimo-v2.5-pro'];
    for (const m of defaults) {
      models.push({ label: m, value: m });
    }
  }

  return models;
}

export function ModelSelector({ currentModel, onSelect, onAddNew }: Props) {
  const [items, setItems] = useState<SavedModel[]>([]);

  useEffect(() => {
    const saved = loadSavedModels();
    // Add "add new" option at the end
    saved.push({ label: '＋ 添加新模型', value: '__add_new__' });
    setItems(saved);
  }, []);

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

/** @jsxImportSource react */
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { PROVIDERS, getModelsForProvider } from '../../config/providers.js';
import { historyForProvider, type ModelHistoryEntry } from '../../config/modelHistory.js';
import { BUILTIN_MODEL_ID } from '../../config/builtin.js';
import type { ProviderName } from '../../config/types.js';

interface Props {
  currentModel: string;
  currentProvider?: ProviderName;
  customModels?: string[];
  onSelect: (model: string) => void;
  onAddNew: () => void;
  onCancel: () => void;
}

interface SavedModel {
  label: string;
  value: string;
}

/**
 * v3.4.2: the list only ever contains models that BELONG to the current
 * provider — builtin (SiliconFlow only), provider-tagged history, the
 * current provider's catalog and the user's custom ids. The old version
 * mixed every provider's history into one list, so picking a foreign id
 * sent the request to the current endpoint (guaranteed 404/401).
 */
function loadSavedModels(currentProvider: ProviderName | undefined, currentModel: string, customModels: string[]): SavedModel[] {
  const models: SavedModel[] = [];
  const seen = new Set<string>();
  const provider = currentProvider || 'siliconflow';

  const push = (id: string, label?: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    models.push({ label: label || id, value: id });
  };

  // 0. built-in shared model — SiliconFlow only (it runs on that endpoint).
  if (provider === 'siliconflow') {
    push(BUILTIN_MODEL_ID, `${BUILTIN_MODEL_ID}（内置共享）`);
  }

  // 1. current model first so the list always anchors on what's live.
  push(currentModel, `${currentModel} (当前)`);

  // 2. provider-tagged history (legacy string entries migrate on read).
  for (const e of historyForProvider(provider, currentModel)) {
    push(e.id);
  }

  // 3. custom ids are provider-agnostic (relay catalogs / new models).
  for (const m of customModels) {
    push(m);
  }

  // 4. the current provider's full catalog.
  for (const m of getModelsForProvider(provider)) {
    push(m.id);
  }

  return models;
}

export function ModelSelector({ currentModel, currentProvider, customModels = [], onSelect, onAddNew, onCancel }: Props) {
  const [items, setItems] = useState<SavedModel[]>([]);

  useEffect(() => {
    const saved = loadSavedModels(currentProvider, currentModel, customModels);
    saved.push({ label: '＋ 添加新模型（运行向导）', value: '__add_new__' });
    setItems(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProvider, currentModel]);

  // v3.4.2: ESC leaves the picker. Previously there was NO way out —
  // ink-select-input has no escape handling and the text input is unmounted
  // in this mode, so a stray /model forced picking a model to escape.
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  const pc = currentProvider ? PROVIDERS[currentProvider]?.name : undefined;
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text color="#06B6D4" bold>当前模型: {currentModel}</Text>
      {pc && <Text dimColor>服务商: {pc}（列表只显示该服务商的模型）</Text>}
      <Text dimColor>选择模型 (↑↓ 回车，esc 取消):</Text>
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

export type { ModelHistoryEntry };

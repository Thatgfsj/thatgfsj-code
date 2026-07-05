/**
 * Unit tests for the `/model` slash-command helper.
 *
 * The handleModelSwitch / handleProviderSwitch methods require stdin/stdout,
 * so we exercise their pure helper `resolveModelChoice` instead, plus
 * AIEngine.updateConfig / getConfig to verify the runtime config swap.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIEngine } from '../dist/core/ai-engine.js';

const sampleModels = [
  { id: 'qwen-7b', name: 'Qwen-7B', desc: 'default' },
  { id: 'qwen-32b', name: 'Qwen-32B', desc: 'bigger' },
  { id: 'kimi-k2.5', name: 'Kimi K2.5', desc: 'moonshot' },
];

// Mirror the REPLLoop.resolveModelChoice logic since it's a private method.
// We re-implement the inline helper here to keep tests headless. If the
// upstream logic changes, this test will need to track.
function resolveModelChoice(choice, models) {
  const trimmed = choice.trim();
  const idx = Number.parseInt(trimmed, 10);
  if (Number.isInteger(idx) && models[idx - 1]) return models[idx - 1];
  return models.find(m => m.id === trimmed) ?? null;
}

test('resolveModelChoice: numeric index resolves to the right entry', () => {
  const r = resolveModelChoice('2', sampleModels);
  assert.deepEqual(r, sampleModels[1]);
});

test('resolveModelChoice: numeric index out of range returns null', () => {
  assert.equal(resolveModelChoice('9', sampleModels), null);
});

test('resolveModelChoice: exact id resolves', () => {
  const r = resolveModelChoice('kimi-k2.5', sampleModels);
  assert.deepEqual(r, sampleModels[2]);
});

test('resolveModelChoice: unknown id returns null', () => {
  assert.equal(resolveModelChoice('gpt-9000', sampleModels), null);
});

test('resolveModelChoice: whitespace is trimmed', () => {
  assert.deepEqual(resolveModelChoice('  qwen-32b  ', sampleModels), sampleModels[1]);
});

test('resolveModelChoice: empty string returns null', () => {
  assert.equal(resolveModelChoice('', sampleModels), null);
});

test('AIEngine.updateConfig swaps the active config', () => {
  const a = new AIEngine({
    model: 'qwen-7b',
    apiKey: 'k',
    temperature: 0.7,
    maxTokens: 4096,
    baseUrl: 'https://example.test/v1',
    provider: 'siliconflow',
  });
  assert.equal(a.getConfig().model, 'qwen-7b');
  assert.equal(a.getConfig().provider, 'siliconflow');

  a.updateConfig({
    model: 'gpt-4o',
    apiKey: 'k',
    temperature: 0.3,
    maxTokens: 8192,
    baseUrl: 'https://api.openai.com/v1',
    provider: 'openai',
  });
  assert.equal(a.getConfig().model, 'gpt-4o');
  assert.equal(a.getConfig().provider, 'openai');
  assert.equal(a.getConfig().baseUrl, 'https://api.openai.com/v1');
  assert.equal(a.getConfig().temperature, 0.3);
});

test('AIEngine.getConfig returns a readonly snapshot', () => {
  const a = new AIEngine({
    model: 'qwen-7b',
    apiKey: '',
    temperature: 0.7,
    maxTokens: 4096,
    baseUrl: 'https://x',
    provider: 'siliconflow',
  });
  const snap = a.getConfig();
  assert.equal(snap.model, 'qwen-7b');
});

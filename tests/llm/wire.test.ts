import { describe, it, expect } from 'vitest';
import { OpenAIProvider } from '../../src/llm/openai.js';
import { GeminiProvider } from '../../src/llm/gemini.js';
import type { ChatMessage } from '../../src/types.js';

const cfg = {
  apiKey: 'test-key',
  model: 'test-model',
  baseUrl: 'https://example.invalid/v1',
  temperature: 0.7,
  maxTokens: 100,
};

describe('OpenAI wire format: mid-conversation system messages (SiliconFlow 20015 fix)', () => {
  const provider = new OpenAIProvider(cfg);

  it('keeps the FIRST system message as system', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'you are a coding agent' },
      { role: 'user', content: 'hi' },
    ];
    const body = (provider as any).buildRequest(msgs, false);
    expect(body.messages[0]).toMatchObject({ role: 'system', content: 'you are a coding agent' });
  });

  it('downgrades LATER system messages to user with [system note] prefix', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'you are a coding agent' },
      { role: 'user', content: 'create a file' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'file', arguments: '{}' } }] },
      { role: 'tool', content: 'denied', tool_call_id: 'c1', name: 'file' },
      { role: 'system', content: '[TOOL_REPAIR] Tool "file" was denied by the user. Ask how to proceed.' },
    ];
    const body = (provider as any).buildRequest(msgs, false);
    const last = body.messages[body.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toBe('[system note] [TOOL_REPAIR] Tool "file" was denied by the user. Ask how to proceed.');
    // no mid-list system roles remain
    const systemIdx = body.messages.map((m: any) => m.role).lastIndexOf('system');
    expect(systemIdx).toBe(0);
  });

  it('handles ContentBlock[] content in downgraded system messages', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u' },
      { role: 'system', content: [{ type: 'text', text: 'block note' }] as any },
    ];
    const body = (provider as any).buildRequest(msgs, false);
    const last = body.messages[body.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toBe('[system note] block note');
  });
});

describe('Gemini wire format: system hoisting', () => {
  const provider = new GeminiProvider(cfg);

  it('concatenates ALL system messages into systemInstruction and drops them from contents', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'main prompt' },
      { role: 'user', content: 'u1' },
      { role: 'system', content: '[TOOL_REPAIR] repair note' },
    ];
    const body = (provider as any).buildRequest(msgs, undefined, undefined);
    expect(body.systemInstruction.parts[0].text).toContain('main prompt');
    expect(body.systemInstruction.parts[0].text).toContain('[TOOL_REPAIR] repair note');
    // no system role inside contents
    for (const c of body.contents) {
      expect(c.role === 'user' || c.role === 'model').toBe(true);
    }
  });
});

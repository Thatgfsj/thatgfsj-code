import { describe, it, expect, vi } from 'vitest';
import { OpenAIProvider } from '../../src/llm/openai.js';
import { AnthropicProvider } from '../../src/llm/anthropic.js';
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

describe('Anthropic wire format: mid-stream system inlining (v3.0.18 cache prefix fix)', () => {
  const provider = new AnthropicProvider(cfg);

  it('keeps the FIRST system message top-level with the cache breakpoint', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'you are a coding agent' },
      { role: 'user', content: 'hi' },
    ];
    const body = (provider as any).buildRequest(msgs, false);
    expect(body.system).toEqual([
      {
        type: 'text',
        text: 'you are a coding agent',
        cache_control: { type: 'ephemeral', ttl: '5m' },
      },
    ]);
    for (const m of body.messages) {
      expect(m.role).not.toBe('system');
    }
  });

  it('downgrades LATER system messages to user turns with [system note] at their original position', () => {
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
    expect(last.content).toEqual([
      { type: 'text', text: '[system note] [TOOL_REPAIR] Tool "file" was denied by the user. Ask how to proceed.' },
    ]);
    // the top-level system prefix stays byte-stable (first message only —
    // accumulated [TOOL_REPAIR] notes must NOT move the cache breakpoint)
    expect(body.system).toHaveLength(1);
    expect(body.system[0].text).toBe('you are a coding agent');
  });

  it('sends the extended-cache-ttl beta header when the resolved TTL is 1h', async () => {
    const p = new AnthropicProvider(cfg);
    p.setResolvedTTL('1h');
    const inits: any[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: any) => {
      inits.push(init);
      return new Response('{}', { status: 200 });
    });
    try {
      await (p as any).doRequest({ model: 'test-model', messages: [] });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(inits[0].headers['anthropic-beta']).toBe(
      'prompt-caching-2024-07-31,extended-cache-ttl-2025-04-11'
    );
  });

  it('keeps the default caching beta header when the resolved TTL is 5m', async () => {
    const p = new AnthropicProvider(cfg);
    p.setResolvedTTL('5m');
    const inits: any[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: any) => {
      inits.push(init);
      return new Response('{}', { status: 200 });
    });
    try {
      await (p as any).doRequest({ model: 'test-model', messages: [] });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(inits[0].headers['anthropic-beta']).toBe('prompt-caching-2024-07-31');
  });
});

describe('Gemini wire format: system hoisting', () => {
  const provider = new GeminiProvider(cfg);

  it('hoists the FIRST system into systemInstruction and inlines LATER ones as user [system note]', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'main prompt' },
      { role: 'user', content: 'u1' },
      { role: 'system', content: '[TOOL_REPAIR] repair note' },
    ];
    const body = (provider as any).buildRequest(msgs, undefined, undefined);
    // first system hoisted; later ones NOT appended to the instruction
    expect(body.systemInstruction.parts[0].text).toContain('main prompt');
    expect(body.systemInstruction.parts[0].text).not.toContain('[TOOL_REPAIR]');
    // later system inlined at its original position (last content turn)
    const last = body.contents[body.contents.length - 1];
    expect(last.role).toBe('user');
    expect(last.parts[0].text).toBe('[system note] [TOOL_REPAIR] repair note');
  });
});

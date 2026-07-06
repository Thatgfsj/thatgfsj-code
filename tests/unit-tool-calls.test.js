/**
 * Tests for v2.2.1 tool-call support.
 *
 * StreamAccumulator is a private class so we exercise it indirectly via
 * the only public entry point that exposes it: `chatStream` returning a
 * non-empty `tool_calls` array. We do that by stubbing `globalThis.fetch`
 * with a fake SSE stream that mimics OpenAI's tool-call deltas.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIEngine } from '../dist/core/ai-engine.js';

/**
 * Build a ReadableStream whose `read()` yields the supplied chunks one
 * at a time. Mimics the shape of a real fetch Response.body.
 */
function sseStream(chunks) {
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(new TextEncoder().encode(chunks[i++]));
    },
  });
}

test('StreamAccumulator aggregates OpenAI delta.tool_calls across chunks', async () => {
  // Mimic OpenAI's tool-call streaming: the same `index=0` call is split
  // across three deltas carrying id, name, then arguments fragments.
  const sseChunks = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","function":{"name":"","arguments":""}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"shell"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"cmd\\":"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"ls\\"}"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Running ls..."}}]}\n\n',
    'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n',
    'data: [DONE]\n\n',
  ];

  globalThis.fetch = async () => new Response(sseStream(sseChunks), { status: 200 });

  const engine = new AIEngine({
    model: 'm',
    apiKey: 'fake',
    baseUrl: 'http://stub',
    provider: 'siliconflow',
  });
  // Register a fake tool so executeToolCall can find it
  engine.registerTool({
    name: 'shell',
    description: 'fake shell',
    parameters: [],
    execute: async (params) => ({ success: true, output: `out:${params.cmd}` }),
  });
  engine.setConfirmAction(async () => true);

  const messages = [{ role: 'user', content: 'list files' }];
  let fullText = '';
  for await (const chunk of engine.chatStream(messages, 3)) {
    fullText += chunk;
  }
  assert.match(fullText, /Running ls\.\.\./, 'text delta was yielded');
  assert.match(fullText, /\[tool: shell\] ✓/, 'tool execution marker was emitted');

  // Tool result was pushed into the messages array; verify via a fresh
  // dummy session trace by checking the engine produced no error and
  // fullText contains a tool-execution sentinel.
  assert.ok(fullText.length > 0);
});

test('OpenAI SSE with no tool_calls yields pure text and exits', async () => {
  const sseChunks = [
    'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
    'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ];
  globalThis.fetch = async () => new Response(sseStream(sseChunks), { status: 200 });

  const engine = new AIEngine({
    model: 'm',
    apiKey: 'fake',
    baseUrl: 'http://stub',
    provider: 'siliconflow',
  });
  let fullText = '';
  for await (const chunk of engine.chatStream([{ role: 'user', content: 'hi' }], 3)) {
    fullText += chunk;
  }
  assert.equal(fullText, 'Hello world');
  assert.doesNotMatch(fullText, /\[tool:/, 'no tool marker on text-only response');
});

test('buildOpenAIRequest sends tools field and omits tool_calls when absent', () => {
  // Access private builder via prototype to verify behavior.
  const engine = new AIEngine({
    model: 'm',
    apiKey: 'fake',
    baseUrl: 'http://stub',
    provider: 'siliconflow',
  });
  engine.registerTool({
    name: 'demo',
    description: 'demo tool',
    parameters: [{ name: 'q', type: 'string', description: 'q', required: true }],
    execute: async () => ({ success: true }),
  });
  const body = engine['buildOpenAIRequest'](
    [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'ok', tool_calls: undefined },
    ],
    true,
  );
  assert.equal(body.stream, true);
  assert.ok(Array.isArray(body.tools) && body.tools.length === 1);
  assert.equal(body.tools[0].function.name, 'demo');
  // The assistant message with no tool_calls should NOT carry a
  // `tool_calls: undefined` field — strict OpenAI servers reject that.
  const asst = body.messages[1];
  assert.equal('tool_calls' in asst, false, 'tool_calls key omitted when absent');
});

test('buildAnthropicRequest converts tool results and sends tools schema', () => {
  const engine = new AIEngine({
    model: 'm',
    apiKey: 'fake',
    baseUrl: 'http://stub',
    provider: 'anthropic',
  });
  engine.registerTool({
    name: 'demo',
    description: 'demo',
    parameters: [],
    execute: async () => ({ success: true }),
  });
  const body = engine['buildAnthropicRequest'](
    [
      { role: 'system', content: 'be helpful' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'demo', arguments: '{"q":1}' } }],
      },
      { role: 'tool', tool_call_id: 't1', name: 'demo', content: 'result-payload' },
      { role: 'user', content: 'thanks' },
    ],
    true,
  );
  // system extracted to top-level
  assert.match(body.system, /be helpful/);
  // tools sent
  assert.ok(Array.isArray(body.tools));
  assert.equal(body.tools[0].name, 'demo');
  // tool_use block present in assistant turn
  const asst = body.messages.find((m) => m.role === 'assistant');
  assert.ok(Array.isArray(asst.content));
  assert.equal(asst.content.some((b) => b.type === 'tool_use' && b.id === 't1'), true);
  // tool_result block present in a user turn (Anthropic's wire shape)
  const resultTurn = body.messages.find(
    (m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'),
  );
  assert.ok(resultTurn, 'a user turn must carry the tool_result block');
});

test('buildGeminiRequest sends functionDeclarations and functionResponse parts', () => {
  const engine = new AIEngine({
    model: 'm',
    apiKey: 'fake',
    baseUrl: 'http://stub',
    provider: 'gemini',
  });
  engine.registerTool({
    name: 'demo',
    description: 'demo',
    parameters: [{ name: 'q', type: 'string', description: 'q', required: true }],
    execute: async () => ({ success: true }),
  });
  const body = engine['buildGeminiRequest'](
    [
      { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'demo', arguments: '{"q":"hi"}' } }] },
      { role: 'tool', tool_call_id: 't1', name: 'demo', content: 'payload' },
    ],
  );
  assert.ok(Array.isArray(body.tools));
  assert.equal(body.tools[0].functionDeclarations[0].name, 'demo');
  // functionCall on model turn
  const modelTurn = body.contents.find((c) => c.role === 'model');
  assert.ok(modelTurn.parts.some((p) => p.functionCall && p.functionCall.name === 'demo'));
  // functionResponse on a user turn
  const userTurn = body.contents.find(
    (c) => c.role === 'user' && c.parts.some((p) => p.functionResponse),
  );
  assert.ok(userTurn, 'a user turn must carry the functionResponse part');
});

test('setConfirmAction injects the confirm callback used by tools', async () => {
  let askedFor = '';
  const engine = new AIEngine({
    model: 'm',
    apiKey: 'fake',
    baseUrl: 'http://stub',
    provider: 'siliconflow',
  });
  engine.setConfirmAction(async (msg) => { askedFor = msg; return false; });
  engine.registerTool({
    name: 'dangerous',
    description: 'demo',
    parameters: [],
    execute: async (_p, ctx) => {
      const ok = await ctx.confirmAction('really?');
      return { success: ok, output: ok ? 'did-it' : 'denied' };
    },
  });
  const sseChunks = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"dangerous","arguments":"{}"}}]}}]}\n\n',
    'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n',
    'data: [DONE]\n\n',
  ];
  globalThis.fetch = async () => new Response(sseStream(sseChunks), { status: 200 });
  let text = '';
  for await (const c of engine.chatStream([{ role: 'user', content: 'do it' }], 2)) text += c;
  assert.match(askedFor, /really\?/, 'confirmAction was called with the tool-supplied message');
});
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { LLMService } from '../../src/llm/index.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import type { Tool } from '../../src/tools/types.js';
import type { ChatMessage, StreamChunk, ToolCall } from '../../src/types.js';

/**
 * v3.5.0 regression: the agent loop must stop early and report honestly
 * when every tool call keeps failing or being denied (field report: a
 * denied task spun all 10 rounds, ~50k tokens, and still returned
 * success:true).
 */
function fakeProvider(rounds: Array<StreamChunk[]>): LLMProvider {
  let round = 0;
  return {
    name: 'fake',
    async chat() {
      return { content: '', role: 'assistant' };
    },
    buildTools() {
      return [];
    },
    async *chatStream(messages) {
      const chunks = rounds[Math.min(round, rounds.length - 1)];
      round++;
      for (const c of chunks) {
        yield c;
      }
      return { content: '', role: 'assistant' };
    },
  } as LLMProvider;
}

function toolCall(name: string, args: string): ToolCall {
  return { id: 'c1', type: 'function', function: { name, arguments: args } };
}

function svcWith(tools: Tool[]): LLMService {
  const svc = new LLMService(fakeProvider([]), 'test-key', 'test-model');
  svc.registerTools(tools);
  return svc;
}

const writeTool: Tool = {
  name: 'denywrite',
  description: 'always denied',
  parameters: [{ name: 'path', type: 'string', description: 'p', required: true }],
  async execute() {
    return { success: false, error: 'File write cancelled by user' };
  },
};

describe('agent loop: failure circuit breaker + loopStats', () => {
  it('aborts after 4 consecutive all-failed rounds instead of running to maxIterations', async () => {
    const svc = svcWith([writeTool]);
    // 10 rounds of the same denied call — the loop must stop at 4.
    const rounds: StreamChunk[][] = [];
    for (let i = 0; i < 10; i++) {
      rounds.push([{
        type: 'tool_calls',
        toolCalls: [toolCall('denywrite', '{"path":"note.txt"}')],
      } as StreamChunk]);
    }
    (svc as any).provider = fakeProvider(rounds);

    const iter = svc.chatStream([{ role: 'user', content: 'go' }] as ChatMessage[]);
    let next = await iter.next();
    const toolChunks: number[] = [];
    while (!next.done) {
      // v3.0.16: each round emits a pending:true announcement first — only
      // the post-execution chunk (with results) counts.
      if (next.value.type === 'tool_calls' && !next.value.pending) toolChunks.push(1);
      next = await iter.next();
    }
    const final = next.value as any;

    expect(toolChunks.length).toBe(4); // stopped at the breaker, not round 10
    expect(final.content).toContain('[AGENT_ABORTED]');
    expect(final.loopStats).toMatchObject({ rounds: 4, toolCalls: 4, denied: 4, failed: 0 });
    expect(final.loopStats.abortedReason).toContain('consecutive');
  });

  it('a success in a round resets the breaker', async () => {
    const flaky: Tool = {
      name: 'flaky',
      description: 'fails unless told otherwise',
      parameters: [{ name: 'ok', type: 'string', description: 'o', required: true }],
      async execute(params) {
        return params.ok === 'yes'
          ? { success: true, output: 'done' }
          : { success: false, error: 'boom' };
      },
    };
    const svc = svcWith([flaky]);
    const rounds: StreamChunk[][] = [
      [{ type: 'tool_calls', toolCalls: [toolCall('flaky', '{"ok":"no"}')] } as StreamChunk],
      [{ type: 'tool_calls', toolCalls: [toolCall('flaky', '{"ok":"no"}')] } as StreamChunk],
      [{ type: 'tool_calls', toolCalls: [toolCall('flaky', '{"ok":"no"}')] } as StreamChunk],
      [{ type: 'tool_calls', toolCalls: [toolCall('flaky', '{"ok":"yes"}')] } as StreamChunk],
      [{ type: 'tool_calls', toolCalls: [toolCall('flaky', '{"ok":"no"}')] } as StreamChunk],
      [{ type: 'tool_calls', toolCalls: [toolCall('flaky', '{"ok":"no"}')] } as StreamChunk],
      [{ type: 'tool_calls', toolCalls: [toolCall('flaky', '{"ok":"no"}')] } as StreamChunk],
      [{ type: 'tool_calls', toolCalls: [toolCall('flaky', '{"ok":"no"}')] } as StreamChunk],
    ];
    (svc as any).provider = fakeProvider(rounds);

    const iter = svc.chatStream([{ role: 'user', content: 'go' }] as ChatMessage[]);
    let next = await iter.next();
    while (!next.done) next = await iter.next();
    const final = next.value as any;

    // 3 failures, success resets, then 4 more failures -> abort on round 8.
    expect(final.content).toContain('[AGENT_ABORTED]');
    expect(final.loopStats.rounds).toBe(8);
    expect(final.loopStats.failed).toBe(7);
    expect(final.loopStats.denied).toBe(0);
  });

  it('empty tool output is coerced to (no output), never undefined', async () => {
    const empty: Tool = {
      name: 'empty',
      description: 'returns empty success',
      parameters: [],
      async execute() {
        return { success: true, output: '' };
      },
    };
    const svc = svcWith([empty]);
    (svc as any).provider = fakeProvider([
      [{ type: 'tool_calls', toolCalls: [toolCall('empty', '{}')] } as StreamChunk],
    ]);

    const iter = svc.chatStream([{ role: 'user', content: 'go' }] as ChatMessage[]);
    let next = await iter.next();
    let toolContent: string | undefined;
    while (!next.done) {
      const v = next.value;
      if (v.type === 'tool_calls') {
        // The folded-back tool message content lives in the messages the
        // provider saw NEXT round; here we only have the result object.
        const res = (v as any).results?.[0];
        toolContent = res?.output;
      }
      next = await iter.next();
    }
    expect(toolContent).toBe('(no output)');
  });
});

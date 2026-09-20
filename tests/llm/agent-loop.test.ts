// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { LLMService } from '../../src/llm/index.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import type { Tool } from '../../src/tools/types.js';
import type { ChatMessage, StreamChunk, ToolCall } from '../../src/types.js';

/**
 * Scripted fake provider: yields queued chunks verbatim each round, then
 * returns a final ChatResponse. Records the messages it was handed so the
 * test can inspect what the agent loop folded back into the conversation.
 */
function fakeProvider(rounds: Array<StreamChunk[]>): LLMProvider & { seen: ChatMessage[][] } {
  let round = 0;
  return {
    name: 'fake',
    seen: [],
    async chat() {
      return { content: '', role: 'assistant' };
    },
    buildTools() {
      return [];
    },
    async *chatStream(messages) {
      this.seen.push([...messages]);
      const chunks = rounds[Math.min(round, rounds.length - 1)];
      round++;
      for (const c of chunks) {
        yield c;
      }
      return { content: '', role: 'assistant' };
    },
  } as LLMProvider & { seen: ChatMessage[][] };
}

const echoTool: Tool = {
  name: 'echo',
  description: 'echo back',
  parameters: [{ name: 'text', type: 'string', description: 'text', required: true }],
  async execute(params) {
    return { success: true, output: `echo:${params.text}` };
  },
};

const call: ToolCall = {
  id: 'c1',
  type: 'function',
  function: { name: 'echo', arguments: '{"text":"hi"}' },
};

describe('agent loop: tool_calls pre-launch (v3.0.16 pending chunk)', () => {
  it('yields pending:true BEFORE execution, then a results chunk after', async () => {
    const provider = fakeProvider([
      // round 1: model emits text + a tool call → agent loop executes it
      [
        { type: 'text', content: 'checking' },
        { type: 'tool_calls', toolCalls: [call] } as StreamChunk,
      ],
      // round 2: model answers, no tools → loop returns
      [{ type: 'text', content: 'done' }],
    ]);
    const svc = new LLMService(provider, 'k');
    svc.registerTools([echoTool]);

    const chunks: StreamChunk[] = [];
    for await (const c of svc.chatStream([{ role: 'user', content: 'run echo' }])) {
      chunks.push(c);
    }

    const tcChunks = chunks.filter(c => c.type === 'tool_calls') as Extract<StreamChunk, { type: 'tool_calls' }>[];
    expect(tcChunks.length).toBe(2);

    // 1st: pre-execution announcement — same toolCalls, pending flag, no results
    expect(tcChunks[0].pending).toBe(true);
    expect(tcChunks[0].results).toBeUndefined();
    expect(tcChunks[0].toolCalls).toHaveLength(1);
    expect(tcChunks[0].toolCalls[0].function.name).toBe('echo');

    // 2nd: post-execution outcome — results index-aligned, NOT pending
    expect(tcChunks[1].pending).toBeUndefined();
    expect(tcChunks[1].results).toEqual([{ name: 'echo', ok: true, output: 'echo:hi' }]);
    expect(tcChunks[1].toolCalls).toHaveLength(1);

    // ordering: pending chunk precedes the results chunk
    expect(chunks.indexOf(tcChunks[0])).toBeLessThan(chunks.indexOf(tcChunks[1]));
  });

  it('does not emit a pending chunk when no tools are called', async () => {
    const provider = fakeProvider([
      [{ type: 'text', content: 'plain answer' }],
    ]);
    const svc = new LLMService(provider, 'k');
    svc.registerTools([echoTool]);

    const chunks: StreamChunk[] = [];
    for await (const c of svc.chatStream([{ role: 'user', content: 'hi' }])) {
      chunks.push(c);
    }
    expect(chunks.some(c => c.type === 'tool_calls')).toBe(false);
    expect(chunks[0]).toEqual({ type: 'text', content: 'plain answer' });
  });
});

describe('agent loop v3.3.0 (mcode-parity: session mirror / abort / runaway)', () => {
  it('mirrors assistant tool_calls and tool results through onMessage', async () => {
    const provider = fakeProvider([
      [
        { type: 'tool_calls', toolCalls: [call] } as StreamChunk,
      ],
      [{ type: 'text', content: 'done' }],
    ]);
    const svc = new LLMService(provider, 'k');
    svc.registerTools([echoTool]);

    const mirrored: ChatMessage[] = [];
    for await (const _c of svc.chatStream([{ role: 'user', content: 'go' }], {
      onMessage: m => mirrored.push(m),
    })) {
      // drain
    }
    expect(mirrored).toHaveLength(2);
    expect(mirrored[0].role).toBe('assistant');
    expect(mirrored[0].tool_calls?.[0].id).toBe('c1');
    expect(mirrored[1].role).toBe('tool');
    expect(mirrored[1].tool_call_id).toBe('c1');
    expect(mirrored[1].content).toBe('echo:hi');
  });

  it('aborts before the next round and stubs results for a mid-group cancel', async () => {
    const ctrl = new AbortController();
    const provider = fakeProvider([
      [
        { type: 'tool_calls', toolCalls: [call] } as StreamChunk,
      ],
      [{ type: 'text', content: 'SHOULD NEVER RUN' }],
    ]);
    const svc = new LLMService(provider, 'k');
    svc.registerTools([echoTool]);

    for await (const c of svc.chatStream([{ role: 'user', content: 'go' }], {
      signal: ctrl.signal,
      onMessage: () => { ctrl.abort(); }, // cancel right after the group lands
    })) {
      if (c.type === 'tool_calls' && c.results) break;
    }
    // The loop must return before round 2 — the fake provider records what
    // it saw, and round 2 must never be requested.
    expect(provider.seen.length).toBe(1);
  });

  it('injects a runaway reminder on the 3rd identical call (soft nudge)', async () => {
    const provider = fakeProvider([
      ...Array.from({ length: 3 }, () => [{ type: 'tool_calls', toolCalls: [call] } as StreamChunk]),
      [{ type: 'text', content: 'done' }],
    ]);
    const svc = new LLMService(provider, 'k');
    svc.registerTools([echoTool]);

    for await (const _c of svc.chatStream([{ role: 'user', content: 'go' }])) {
      // drain
    }
    // Round 4's request must carry the reminder after the 3rd identical call.
    const last = provider.seen[provider.seen.length - 1];
    expect(last.some(m => m.role === 'system' && m.content.includes('IDENTICAL arguments'))).toBe(true);
  });

  it('beforeRound can replace the message array (pre-call compaction hook)', async () => {
    const provider = fakeProvider([
      [{ type: 'text', content: 'ok' }],
    ]);
    const svc = new LLMService(provider, 'k');
    const replacement: ChatMessage[] = [{ role: 'user', content: 'compacted view' }];
    for await (const _c of svc.chatStream([{ role: 'user', content: 'huge history' }], {
      beforeRound: () => replacement,
    })) {
      // drain
    }
    expect(provider.seen[0]).toHaveLength(1);
    expect(provider.seen[0][0].content).toBe('compacted view');
  });
});

import { describe, it, expect } from 'vitest';
import { ContextCompactor, splitIntoGroups } from '../../src/session/compactor.js';
import type { ChatMessage } from '../../src/types.js';

function toolCallPair(id: string): ChatMessage[] {
  return [
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id, type: 'function', function: { name: 'shell', arguments: '{"command":"ls"}' } }],
    },
    { role: 'tool', content: 'file-a\nfile-b', tool_call_id: id, name: 'shell' },
  ];
}

describe('splitIntoGroups', () => {
  it('keeps a tool result attached to its assistant tool_calls message', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'list files' },
      ...toolCallPair('1'),
      { role: 'assistant', content: 'here are the files' },
    ];
    const groups = splitIntoGroups(msgs);
    expect(groups).toHaveLength(3);
    expect(groups[1].messages).toHaveLength(2);
    expect(groups[1].messages[0].tool_calls).toBeDefined();
    expect(groups[1].messages[1].role).toBe('tool');
  });

  it('isolates an orphaned tool result instead of merging it upward', () => {
    const groups = splitIntoGroups([
      { role: 'tool', content: 'orphan', tool_call_id: 'x' },
      { role: 'user', content: 'hi' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].messages[0].role).toBe('tool');
  });
});

describe('ContextCompactor (v3.0.5 atomic groups)', () => {
  it('returns input unchanged under the limit', () => {
    const c = new ContextCompactor({ maxMessages: 50 });
    const msgs: ChatMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }];
    const { compacted, result } = c.compact(msgs);
    expect(compacted).toBe(msgs);
    expect(result.removedCount).toBe(0);
  });

  it('never splits a tool_calls/result pair across the summary boundary', () => {
    const c = new ContextCompactor({ maxMessages: 6, preserveRecent: 4 });
    const msgs: ChatMessage[] = [{ role: 'system', content: 'sys prompt' }];
    // old history: user + full tool pair, repeated several times
    for (let i = 0; i < 5; i++) {
      msgs.push({ role: 'user', content: `question ${i}` });
      msgs.push(...toolCallPair(`call-${i}`));
      msgs.push({ role: 'assistant', content: `answer ${i}` });
    }
    const { compacted } = c.compact(msgs);

    // Invariant: every assistant.tool_calls is immediately followed by ALL
    // of its tool results inside the compacted list.
    for (let i = 0; i < compacted.length; i++) {
      const m = compacted[i];
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        const next = compacted[i + 1];
        expect(next?.role).toBe('tool');
        expect(next?.tool_call_id).toBe(m.tool_calls![0].id);
      }
      if (m.role === 'tool') {
        const prev = compacted[i - 1];
        expect(prev?.role).toBe('assistant');
        expect(prev?.tool_calls?.some(tc => tc.id === m.tool_call_id)).toBe(true);
      }
    }
  });

  it('places the summary after the system prompt, before kept messages', () => {
    const c = new ContextCompactor({ maxMessages: 4, preserveRecent: 2 });
    const msgs: ChatMessage[] = [{ role: 'system', content: 'sys' }];
    for (let i = 0; i < 6; i++) {
      msgs.push({ role: 'user', content: `q${i}` });
      msgs.push({ role: 'assistant', content: `a${i}` });
    }
    const { compacted } = c.compact(msgs);
    expect(compacted[0].role).toBe('system');
    expect(compacted[0].content).toBe('sys');
    expect(compacted[1].role).toBe('system');
    expect(compacted[1].content).toContain('[CONTEXT CHECKPOINT');
    expect(compacted[1].content).toContain('q0');
    // no assistant tool_calls carriers left dangling
    for (const m of compacted) {
      if (m.role === 'assistant') {
        expect(m.tool_calls ?? []).toHaveLength(0);
      }
    }
  });
});

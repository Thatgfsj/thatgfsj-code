import { describe, it, expect } from 'vitest';
import { decideTTL, totalConversationChars, shouldDowngrade } from '../../src/cache/smartModel.js';
import type { ChatMessage } from '../../src/types.js';

function userMsg(s: string): ChatMessage {
  return { role: 'user', content: s };
}
function assistantMsg(s: string): ChatMessage {
  return { role: 'assistant', content: s };
}

describe('decideTTL', () => {
  it('round 0 → 5m (default)', () => {
    const d = decideTTL([], null);
    expect(d.ttl).toBe('5m');
    expect(d.isFirstDecision).toBe(true);
  });

  it('short session (≤14 turns, <50k chars) → 5m', () => {
    const messages = [
      userMsg('hello'),
      assistantMsg('hi'),
      userMsg('how are you?'),
      assistantMsg('good'),
    ];
    const d = decideTTL(messages, null);
    expect(d.ttl).toBe('5m');
    expect(d.reason).toMatch(/short-session/);
  });

  it('long session (≥15 turns) → 1h', () => {
    // Build 16 user + 16 assistant = 32 messages (16 turns)
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 16; i++) {
      messages.push(userMsg(`question ${i}`));
      messages.push(assistantMsg(`answer ${i} long enough to be content`));
    }
    const d = decideTTL(messages, null);
    expect(d.ttl).toBe('1h');
    expect(d.reason).toMatch(/long-session/);
  });

  it('large context (>50k chars) → 1h even with few turns', () => {
    const bigContent = 'x'.repeat(60_000);
    const messages: ChatMessage[] = [
      userMsg('hi'),
      { role: 'assistant', content: bigContent },
    ];
    const d = decideTTL(messages, null);
    expect(d.ttl).toBe('1h');
    expect(d.reason).toMatch(/long-context/);
  });

  it('reuses previous TTL (stability rule)', () => {
    const messages = [userMsg('hello'), assistantMsg('hi')];
    const d1 = decideTTL(messages, null);
    expect(d1.ttl).toBe('5m');
    expect(d1.isFirstDecision).toBe(true);

    // Now grow to 30 turns without changing TTL
    for (let i = 0; i < 30; i++) {
      messages.push(userMsg(`q${i}`));
      messages.push(assistantMsg(`a${i}`));
    }
    const d2 = decideTTL(messages, '5m');
    expect(d2.ttl).toBe('5m');
    expect(d2.isFirstDecision).toBe(false);
    expect(d2.reason).toBe('reused-from-previous-round');
  });
});

describe('totalConversationChars', () => {
  it('sums string content', () => {
    const total = totalConversationChars([
      userMsg('abc'),
      assistantMsg('defgh'),
    ]);
    expect(total).toBe(8);
  });

  it('handles array content blocks', () => {
    const total = totalConversationChars([
      { role: 'user', content: [
        { type: 'text', text: 'hello' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'XXXX' } },
      ] as any },
    ]);
    expect(total).toBe(5);
  });
});

describe('shouldDowngrade', () => {
  it('downgrades short prompts without tool calls', () => {
    const d = shouldDowngrade([], 'hi');
    expect(d.downgrade).toBe(true);
  });

  it('does not downgrade long prompts', () => {
    const d = shouldDowngrade([], 'x'.repeat(300));
    expect(d.downgrade).toBe(false);
    expect(d.reason).toBe('prompt-too-long');
  });

  it('does not downgrade when recent tool calls exist', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: '...', tool_calls: [{ id: '1', type: 'function', function: { name: 'f', arguments: '{}' } }] },
    ];
    const d = shouldDowngrade(messages, 'hi');
    expect(d.downgrade).toBe(false);
    expect(d.reason).toBe('recent-tool-call');
  });
});

// @vitest-environment node
/** @jsxImportSource react */
import React, { useEffect } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Box, Text } from 'ink';
import { useChat } from '../../src/tui/hooks/useChat.js';
import { ChatList } from '../../src/tui/components/ChatList.js';
import type { MessageData } from '../../src/tui/components/ChatMessage.js';
import type { App } from '../../src/app/index.js';
import type { StreamChunk, Usage } from '../../src/types.js';

/**
 * v3.0.16 scroll-wheel fix — runtime proof of the append-only contract:
 *   1. streamed text/tool lines NEVER enter React state (messages stays
 *      user/notices-only for the whole turn) — they go straight to stdout
 *      through Ink's write channel;
 *   2. fullContent accumulation + persistence is unchanged;
 *   3. pending tool_calls chunks paint the ⟳ line, results chunks the
 *      outcome line, and the turn ends with the token chip.
 */

const USAGE: Usage = {
  prompt_tokens: 1000,
  completion_tokens: 1200,
  total_tokens: 2200,
};

function fakeApp(chunks: StreamChunk[], captured: {
  persisted: string[];
  sessionMsgs: Array<{ role: string; content: unknown }>;
}) {
  return {
    config: { get: () => ({ model: 'test-model' }) },
    showThinking: false,
    session: {
      addMessage: (role: string, content: unknown) => {
        captured.sessionMsgs.push({ role, content });
      },
      addMessageSafe: (role: string, content: string) => {
        captured.persisted.push(content);
        return true;
      },
      persist: () => {},
    },
    maybeAutoCompact: () => null,
    async *streamResponse(): AsyncGenerator<StreamChunk, { content: string; role: 'assistant' }> {
      for (const c of chunks) {
        await new Promise(r => setTimeout(r, 4));
        yield c;
      }
      return { content: '', role: 'assistant' };
    },
  } as unknown as App;
}

const CALL = {
  id: 'c1',
  type: 'function' as const,
  function: { name: 'echo', arguments: '{"text":"hi"}' },
};

function Harness({ app, snapshots, cancelRef }: {
  app: App;
  snapshots: { messages: MessageData[][]; usage: Array<Usage | null> };
  cancelRef?: { current: (() => void) | null };
}) {
  const chat = useChat(app);
  snapshots.messages.push(chat.messages);
  snapshots.usage.push(chat.lastUsage);
  if (cancelRef) cancelRef.current = chat.cancel;
  useEffect(() => {
    chat.sendMessage('hello');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Box flexDirection="column">
      <Text>FRAME-SENTINEL</Text>
      <ChatList messages={chat.messages} mode="Build" model="test-model" />
    </Box>
  );
}

describe('useChat append-only streaming (v3.0.16 scroll-wheel fix)', () => {
  it('streams text/tools to stdout, keeps them out of React state, persists fullContent', async () => {
    const captured = { persisted: [] as string[], sessionMsgs: [] as Array<{ role: string; content: unknown }> };
    const snapshots = { messages: [] as MessageData[][], usage: [] as Array<Usage | null> };
    const chunks: StreamChunk[] = [
      { type: 'text', content: 'ZQX-A' },
      { type: 'text', content: '-B' },
      { type: 'tool_calls', toolCalls: [CALL], pending: true },
      { type: 'tool_calls', toolCalls: [CALL], results: [{ name: 'echo', ok: true, output: 'echo:hi' }] },
      { type: 'text', content: '-C ZQX-DONE' },
      { type: 'usage', usage: USAGE },
    ];
    const { frames } = render(<Harness app={fakeApp(chunks, captured)} snapshots={snapshots} />);

    // stream finished + state settled
    await vi.waitFor(() => {
      expect(captured.persisted).toHaveLength(1);
    });
    // let the final React commit flush
    await new Promise(r => setTimeout(r, 120));

    // 1. fullContent accumulation + persistence unchanged (compression off):
    //    user rides addMessage, assistant rides addMessageSafe — same as before.
    expect(captured.persisted[0]).toBe('ZQX-A-B-C ZQX-DONE');
    expect(captured.sessionMsgs).toEqual([{ role: 'user', content: 'hello' }]);

    // 2. v3.0.18: streamed content DOES enter the Static list, but only as
    //    plain items — never as a labeled assistant message that the frame
    //    would re-render.
    for (const msgs of snapshots.messages) {
      for (const m of msgs) {
        if (m.role === 'assistant' && String(m.content).includes('ZQX')) {
          expect(m.plain).toBe(true);
        }
      }
    }

    // 3. output went through the stdout write channel instead: streamed text
    //    (flushed in frame-budget batches), the pending ⟳ line, the result
    //    line and the token chip all landed.
    const all = frames.join('');
    expect(all).toContain('ZQX-A-B');
    expect(all).toContain('-C ZQX-DONE');
    expect(all).toContain('⎿ echo');
    expect(all).toContain('⟳');
    expect(all).toContain('echo:hi');
    expect(all).toContain('1.2kt');

    // 4. usage surfaced for the Header cache chip
    expect(snapshots.usage.at(-1)?.completion_tokens).toBe(1200);

    // 5. the final display list: user message + plain streamed items only
    const finalMsgs = snapshots.messages.at(-1)!;
    expect(finalMsgs.some(m => m.role === 'user' && m.content === 'hello')).toBe(true);
    for (const m of finalMsgs) {
      if (m.role === 'assistant') expect(m.plain).toBe(true);
    }
  });

  it('abort keeps streamed text on stdout, skips persistence, adds only a notice', async () => {
    const captured = { persisted: [] as string[], sessionMsgs: [] as Array<{ role: string; content: unknown }> };
    const snapshots = { messages: [] as MessageData[][], usage: [] as Array<Usage | null> };
    const cancelRef: { current: (() => void) | null } = { current: null };
    const chunks: StreamChunk[] = [
      { type: 'text', content: 'ABORT-MARKER partial' },
    ];
    // Streams one chunk, then hangs until the caller's AbortSignal fires.
    const app = {
      ...fakeApp(chunks, captured),
      async *streamResponse(_msgs?: unknown, opts?: { signal?: AbortSignal }) {
        yield chunks[0];
        await new Promise((_, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
        });
        return { content: '', role: 'assistant' };
      },
    } as unknown as App;
    const { frames } = render(<Harness app={app} snapshots={snapshots} cancelRef={cancelRef} />);

    // first chunk reached stdout…
    await vi.waitFor(() => {
      expect(frames.join('')).toContain('ABORT-MARKER');
    });
    // …then the user cancels mid-stream
    await vi.waitFor(() => {
      expect(cancelRef.current).toBeTruthy();
    });
    cancelRef.current!();
    await new Promise(r => setTimeout(r, 120));

    // partial content was NOT persisted (v2.2.4 rule)
    expect(captured.persisted).toEqual([]);
    // the LAST item is the [已中断] notice; streamed partial text only
    // appears as plain items (v3.0.18 contract)
    const flat = snapshots.messages.flat();
    expect(flat.at(-1)?.content).toBe('[已中断]');
    for (const m of flat) {
      if (m.role === 'assistant' && String(m.content).includes('ABORT-MARKER')) {
        expect(m.plain).toBe(true);
      }
    }
  });
});

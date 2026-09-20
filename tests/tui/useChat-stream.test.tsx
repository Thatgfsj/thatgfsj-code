// @vitest-environment node
/** @jsxImportSource react */
import React, { useEffect } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Box, Text } from 'ink';
import { useChat } from '../../src/tui/hooks/useChat.js';
import { ChatMessage } from '../../src/tui/components/ChatMessage.js';
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
      {/* v3.3.0: the app renders the window via ChatMessage directly (no
          Static) — mirror that here so the test exercises the real path. */}
      {chat.messages.map((m, i) => (
        <ChatMessage key={i} message={m} mode="Build" model="test-model" />
      ))}
    </Box>
  );
}

describe('useChat streaming (v3.3.0 live-paragraph rendering)', () => {
  it('commits streamed text as ONE markdown message at boundaries; tool lines keep order', async () => {
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

    // stream finished + state settled (generous timeout: under a full
    // parallel vitest run this harness can start slowly)
    await vi.waitFor(() => {
      expect(captured.persisted).toHaveLength(1);
    }, { timeout: 10000, interval: 100 });
    // let the final React commit flush
    await new Promise(r => setTimeout(r, 150));

    // 1. fullContent accumulation + persistence unchanged (compression off).
    expect(captured.persisted[0]).toBe('ZQX-A-B-C ZQX-DONE');
    expect(captured.sessionMsgs).toEqual([{ role: 'user', content: 'hello' }]);

    // 2. v3.3.0: the live block commits as ONE markdown message per text
    //    run ('ZQX-A-B' before the tool, 'ZQX-DONE…' after) — NOT a pile
    //    of per-batch plain lines (those wrapped Chinese into a ragged
    //    narrow column).
    const all = frames.join('');
    expect(all).toContain('ZQX-A-B');
    expect(all).toContain('-C ZQX-DONE');
    expect(all).toContain('⎿ echo');
    expect(all).toContain('⟳');
    expect(all).toContain('echo:hi');
    expect(all).toContain('1.2kt');

    // 3. chronological order: first text run, THEN the tool line.
    expect(all.indexOf('ZQX-A-B')).toBeLessThan(all.indexOf('⎿ echo'));

    // 4. usage surfaced for the Header cache chip
    expect(snapshots.usage.at(-1)?.completion_tokens).toBe(1200);

    // 5. final display list: user message + the two committed text runs
    const finalMsgs = snapshots.messages.at(-1)!;
    expect(finalMsgs.some(m => m.role === 'user' && m.content === 'hello')).toBe(true);
    const textMsgs = finalMsgs.filter(m => m.role === 'assistant' && String(m.content).includes('ZQX'));
    expect(textMsgs.map(m => m.content)).toEqual(['ZQX-A-B', '-C ZQX-DONE']);
  });

  it('renders the current run as a live paragraph — words never split across lines', async () => {
    const captured = { persisted: [] as string[], sessionMsgs: [] as Array<{ role: string; content: unknown }> };
    const snapshots = { messages: [] as MessageData[][], usage: [] as Array<Usage | null> };
    const chunks: StreamChunk[] = [
      { type: 'text', content: 'say alpha' },
      { type: 'text', content: 'betomega' },
      { type: 'text', content: ' end' },
      { type: 'usage', usage: USAGE },
    ];
    const app = {
      ...fakeApp(chunks, captured),
      async *streamResponse(): AsyncGenerator<StreamChunk, { content: string; role: 'assistant' }> {
        yield chunks[0];
        await new Promise(r => setTimeout(r, 320)); // live view paints here
        yield chunks[1];
        yield chunks[2];
        await new Promise(r => setTimeout(r, 30));
        return { content: '', role: 'assistant' };
      },
    } as unknown as App;
    const { frames } = render(<Harness app={app} snapshots={snapshots} />);
    await vi.waitFor(() => {
      expect(captured.persisted).toHaveLength(1);
    });
    await new Promise(r => setTimeout(r, 150));

    const all = frames.join('');
    // The run commits as ONE growing paragraph — 'alphabetomega' is never
    // split into separate ragged lines.
    expect(all).toContain('say alphabetomega end');
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
        // Abort may fire before this listener attaches — an
        // already-aborted signal must throw immediately (like fetch does).
        if (opts?.signal?.aborted) throw new Error('AbortError');
        await new Promise((_, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
        });
        return { content: '', role: 'assistant' };
      },
    } as unknown as App;
    const { frames } = render(<Harness app={app} snapshots={snapshots} cancelRef={cancelRef} />);

    // cancel mid-stream (the live view itself lives in app.tsx's frame,
    // not in this harness — the committed block appears after the cancel)
    await vi.waitFor(() => {
      expect(cancelRef.current).toBeTruthy();
    }, { timeout: 10000, interval: 100 });
    // let the stream actually start (user cancels WHILE it streams)
    await new Promise(r => setTimeout(r, 150));
    cancelRef.current!();
    await vi.waitFor(() => {
      expect(frames.join("")).toContain("ABORT-MARKER");
    }, { timeout: 10000, interval: 100 });

    // partial content was NOT persisted (v2.2.4 rule)
    expect(captured.persisted).toEqual([]);
    // the LAST item is the [已中断] notice; the partial live block is
    // committed for DISPLAY (v3.3.0) but never persisted.
    const flat = snapshots.messages.flat();
    expect(flat.at(-1)?.content).toBe('[已中断]');
    expect(flat.some(m => String(m.content).includes('ABORT-MARKER'))).toBe(true);
  });
});

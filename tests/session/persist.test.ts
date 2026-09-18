import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SessionManager, sessionsDir, sanitizeLoadedMessages } from '../../src/session/index.js';
import type { ChatMessage } from '../../src/types.js';

// sessionsDir() resolves under os.homedir(); point HOME/USERPROFILE at a
// temp dir so tests never touch the real ~/.thatgfsj.
let tmpHome: string;

beforeAll(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'gfcode-sessions-'));
  process.env.USERPROFILE = tmpHome;
  process.env.HOME = tmpHome;
});

afterAll(() => {
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('SessionManager persistence', () => {
  it('persist() writes a file that list() and load() can read back', () => {
    const s = new SessionManager(50);
    s.addMessage('system', 'you are a coding agent');
    s.addMessage('user', 'hello');
    s.addMessage('assistant', 'world');
    s.persist();

    const list = SessionManager.list(10);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(s.getId());
    expect(list[0].preview).toBe('hello');

    const file = SessionManager.load(s.getId());
    expect(file).not.toBeNull();
    expect(file!.messages.map(m => m.content)).toEqual([
      'you are a coding agent', 'hello', 'world',
    ]);
  });

  it('restore() loads history in place', () => {
    const a = new SessionManager(50);
    a.addMessage('system', 'sys');
    a.addMessage('user', 'q1');
    a.addMessage('assistant', 'a1');
    a.persist();

    const b = new SessionManager(50);
    const file = SessionManager.load(a.getId())!;
    b.loadFrom(file);
    expect(b.getMessageCount()).toBe(3);
    expect(b.getMessages()[1]).toMatchObject({ role: 'user', content: 'q1' });
  });

  it('reset() keeps the system prompt (old clear() dropped it)', () => {
    const s = new SessionManager(50);
    s.addMessage('system', 'keep me');
    s.addMessage('user', 'q');
    s.addMessage('assistant', 'a');
    s.reset();
    expect(s.getMessageCount()).toBe(1);
    expect(s.getMessages()[0]).toMatchObject({ role: 'system', content: 'keep me' });
  });

  it('auto-compact fires once across the threshold and keeps pairs atomic', () => {
    const s = new SessionManager(8);
    const toasts: Array<{ before: number; after: number }> = [];
    s.onAutoCompact = (info) => toasts.push(info);

    for (let i = 0; i < 6; i++) {
      s.addMessage('user', `question ${i} — please do something`);
      s.addMessage('assistant', `answer ${i}`);
    }
    expect(toasts.length).toBeGreaterThanOrEqual(1);
    const afterFirst = toasts[0].after;
    expect(afterFirst).toBeLessThan(toasts[0].before);

    // messages must include the system-less summary + recent pairs; and no
    // dangling tool messages exist (none were added).
    for (const m of s.getMessages()) {
      expect(['user', 'assistant', 'system']).toContain(m.role);
    }
  });

  it('pruneSessions keeps the newest 20 files', () => {
    for (let i = 0; i < 23; i++) {
      const s = new SessionManager(50);
      s.addMessage('user', `session ${i}`);
      s.persist();
    }
    const list = SessionManager.list(100);
    expect(list.length).toBeLessThanOrEqual(20);
  });
});

describe('sanitizeLoadedMessages', () => {
  it('strips dangling tool_calls at the end of a crashed round', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'run it' },
      {
        role: 'assistant', content: '',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'shell', arguments: '{}' } }],
      },
      // crash: no tool result followed
    ];
    const out = sanitizeLoadedMessages(msgs);
    expect(out[1].tool_calls).toBeUndefined();
  });

  it('drops orphaned tool results', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'tool', content: 'result', tool_call_id: 'gone' },
    ];
    const out = sanitizeLoadedMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
  });

  it('keeps complete tool pairs intact', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'assistant', content: '',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'file', arguments: '{}' } }],
      },
      { role: 'tool', content: 'ok', tool_call_id: 'c1', name: 'file' },
    ];
    const out = sanitizeLoadedMessages(msgs);
    expect(out).toHaveLength(2);
    expect(out[0].tool_calls).toBeDefined();
    expect(out[1].role).toBe('tool');
  });
});

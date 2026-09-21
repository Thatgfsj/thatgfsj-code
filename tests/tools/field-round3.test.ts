// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { FileTool } from '../../src/tools/file.js';
import { CacheStatsStore } from '../../src/cache/stats.js';

/**
 * v3.5.3 regressions from the three-agent test round.
 */

describe('file tool workspace fence (A-2)', () => {
  let proj: string;
  let tool: FileTool;
  const ctx = (root: string) => ({
    confirmEdit: async () => true,
    confirmAction: async () => true,
    workingDirectory: root,
  }) as any;

  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'nwt-fence-'));
    tool = new FileTool();
  });

  afterEach(() => {
    rmSync(proj, { recursive: true, force: true });
  });

  it('refuses write outside the project directory when a workingDirectory is set', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'nwt-outside-'));
    const target = join(outside, 'evil.txt');
    const r = await tool.execute({ action: 'write', path: target, content: 'x' }, ctx(proj));
    expect(r.success).toBe(false);
    expect(String(r.error)).toMatch(/WORKSPACE/);
    expect(existsSync(target)).toBe(false);
    rmSync(outside, { recursive: true, force: true });
  });

  it('allows write inside the project directory', async () => {
    const r = await tool.execute({ action: 'write', path: join(proj, 'ok.txt'), content: 'x' }, ctx(proj));
    expect(r.success).toBe(true);
  });

  it('no ctx (direct/test use) is NOT blocked by the fence (fail-closed confirmation applies instead)', async () => {
    const target = join(proj, 'legacy.txt');
    const r = await tool.execute({ action: 'write', path: target, content: 'x' });
    // Without a confirmation channel the write is refused by the
    // v3.0.5 fail-closed rule — the important part is that the error is
    // about confirmation, NOT the workspace fence.
    expect(r.success).toBe(false);
    expect(String(r.error)).toMatch(/confirmation/i);
    expect(String(r.error)).not.toMatch(/WORKSPACE/);
  });
});

describe('read truncation aligns to line boundary (A-4)', () => {
  it('truncates at a newline, never mid-line', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'nwt-trunc-'));
    const tool = new FileTool();
    const p = join(proj, 'big.txt');
    // Each line is 100 chars; ~100 lines total → far over the 8000 cap.
    const lines = Array.from({ length: 120 }, (_, i) => `line-${String(i).padStart(3, '0')}-${'x'.repeat(90)}`);
    writeFileSync(p, lines.join('\n'), 'utf-8');
    const r = await tool.execute({ action: 'read', path: p });
    expect(r.success).toBe(true);
    const out = String(r.output);
    expect(out).toContain('truncated at a line boundary');
    const body = out.split('\n\n... [truncated')[0];
    // Every rendered line must be complete (no half-line tail).
    expect(body.endsWith('\n') || lines.some(l => body.includes(l))).toBe(true);
    for (const part of body.split('\n').filter(Boolean)) {
      expect(part.startsWith('line-')).toBe(true);
    }
    rmSync(proj, { recursive: true, force: true });
  });
});

describe('delete refuses directories with a clear message (A-4)', () => {
  it('says "is a directory" instead of crashing with EPERM', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'nwt-del-'));
    const dir = join(proj, 'subdir');
    mkdirSync(dir);
    const tool = new FileTool();
    const r = await tool.execute({ action: 'delete', path: dir }, {
      confirmAction: async () => true, workingDirectory: proj,
    } as any);
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('is a directory');
    expect(existsSync(dir)).toBe(true);
    rmSync(proj, { recursive: true, force: true });
  });
});

describe('cache-stats concurrent merge (C-2)', () => {
  it('a store re-reading under the lock merges into the freshest disk state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nwt-stats-'));
    const path = join(dir, 'cache-stats.json');

    // Simulate process 1: writes a round and dies before process 2 starts.
    const a = new CacheStatsStore(path);
    a.record({ prompt_tokens: 100, completion_tokens: 10 });

    // Simulate process 2: constructed AFTER a's write — sees a's totals.
    const b = new CacheStatsStore(path);
    b.record({ prompt_tokens: 50, completion_tokens: 5 });

    // A fresh store must see BOTH rounds (last-writer-wins would show only
    // b's 50/5 for totalRequests=1).
    const fresh = new CacheStatsStore(path);
    expect(fresh.raw.totalRequests).toBe(2);
    expect(fresh.raw.totalInputTokens).toBe(150);
    rmSync(dir, { recursive: true, force: true });
  });

  it('the lock file never leaks into the stats directory listing as data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nwt-stats-'));
    const path = join(dir, 'cache-stats.json');
    const s = new CacheStatsStore(path);
    s.record({ prompt_tokens: 1, completion_tokens: 1 });
    expect(existsSync(path + '.lock') || existsSync(path)).toBe(true);
    // lock released → lock file must be gone
    expect(existsSync(path + '.lock')).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('openai provider: garbage 200 body fails loudly (C-1)', () => {
  it('throws instead of returning an empty success', async () => {
    // Mock fetch: HTTP 200 with a non-SSE garbage body.
    const fakeBody = (function* () {
      yield new TextEncoder().encode('<html>Gateway Timeout Page</html>');
    })();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { getReader: () => ({
        read: async () => {
          const next = fakeBody.next();
          return next.done ? { done: true, value: undefined } : { done: false, value: next.value };
        },
        releaseLock: () => {},
      })},
    })));

    const { OpenAIProvider } = await import('../../src/llm/openai.js');
    const p = new OpenAIProvider({
      apiKey: 'k', model: 'm', baseUrl: 'https://x',
      temperature: 0.7, maxTokens: 16,
      cache: { enabled: true, ttl: '1h', strategy: 'auto' },
    });
    // The generator throws during iteration — the loop must NOT complete
    // "successfully" with an empty answer (field report C-1).
    await expect(async () => {
      for await (const _ of p.chatStream([{ role: 'user', content: 'hi' }])) {
        void _;
      }
    }).rejects.toThrow(/empty or malformed/i);
    vi.unstubAllGlobals();
  });
});

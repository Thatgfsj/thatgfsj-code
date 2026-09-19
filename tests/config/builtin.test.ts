import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BUILTIN_MODEL_ID, revealBuiltinKey } from '../../src/config/builtin.js';
import { ConfigManager } from '../../src/config/index.js';

/** SHA-256 of the real shared key — pins the fragments without plaintext. */
const KEY_HASH = '3642db5b92e666dea68e2b630cc3b0f3f29c24cb64353b722067c40b51116e53';

let root: string;
let prevUserProfile: string | undefined;
let prevHome: string | undefined;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gfcode-builtin-'));
  mkdirSync(join(root, '.thatgfsj'), { recursive: true });
  prevUserProfile = process.env.USERPROFILE;
  prevHome = process.env.HOME;
  process.env.USERPROFILE = root;
  process.env.HOME = root;
  // isolation: no env keys may leak into these tests
  for (const k of Object.keys(process.env)) {
    if (/SILICONFLOW_API_KEY/i.test(k)) delete process.env[k];
  }
});

afterAll(() => {
  if (prevUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUserProfile;
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('built-in shared key fragments', () => {
  it('reassembles to the exact shared key (sha256 pinned, no plaintext in test)', () => {
    const key = revealBuiltinKey();
    expect(key.startsWith('sk-')).toBe(true);
    expect(key.length).toBe(51);
    expect(createHash('sha256').update(key).digest('hex')).toBe(KEY_HASH);
  });

  it('is cached and stable across calls', () => {
    expect(revealBuiltinKey()).toBe(revealBuiltinKey());
  });

  it('never appears in source-controlled files as plaintext', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'config', 'builtin.ts'), 'utf-8');
    expect(src).not.toContain(revealBuiltinKey());
  });
});

describe('getAIConfig built-in fallback (v3.1.2)', () => {
  it('falls back to the built-in SiliconFlow model when no key is configured', async () => {
    const config = await ConfigManager.load();
    expect(config.hasApiKey()).toBe(false);

    const ai = config.getAIConfig();
    expect(ai.usingBuiltinKey).toBe(true);
    expect(ai.provider).toBe('siliconflow');
    expect(ai.model).toBe(BUILTIN_MODEL_ID);
    expect(ai.model).toBe('Qwen/Qwen3.5-4B');
    expect(ai.apiKey).toBe(revealBuiltinKey());
    expect(ai.baseUrl).toContain('siliconflow');

    // the shared key must NOT leak into the persisted config
    expect(config.get().apiKey).toBe('');
  });

  it('user key wins: no fallback, model preserved, key never replaced', async () => {
    writeFileSync(
      join(root, '.thatgfsj', 'config.json'),
      JSON.stringify({ model: 'deepseek-chat', apiKey: 'sk-user-key', provider: 'deepseek' }),
      'utf-8',
    );
    const config = await ConfigManager.load();
    expect(config.hasApiKey()).toBe(true);

    const ai = config.getAIConfig();
    expect(ai.usingBuiltinKey).toBeUndefined();
    expect(ai.provider).toBe('deepseek');
    expect(ai.model).toBe('deepseek-chat');
    expect(ai.apiKey).toBe('sk-user-key');
  });
});

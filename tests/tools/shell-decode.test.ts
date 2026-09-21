// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { decodeConsoleOutput } from '../../src/tools/shell.js';

/**
 * v3.5.1 regressions for console decoding (field report: `type <missing>`
 * on a GBK console still produced mojibake — strict-UTF-8-first wrongly
 * accepted GBK bytes, since GBK Chinese is usually VALID UTF-8).
 */

function consoleCodePage(): number | null {
  if (process.platform !== 'win32') return null;
  try {
    const out = execSync('chcp', { encoding: 'utf8', windowsHide: true });
    return Number(out.match(/(\d+)/)?.[1] ?? 0) || null;
  } catch {
    return null;
  }
}

const cp = consoleCodePage();
// The GBK test is only meaningful on a legacy-code-page console (936 etc.).
// On 65001 consoles cmd.exe itself emits UTF-8, so bytes differ.
const onLegacyCp = it.skipIf(cp === null || cp === 65001);

describe('decodeConsoleOutput', () => {
  // "系统找不到指定的文件" encoded in GBK (what cmd.exe emits on a 936 box).
  const GBK_FILE_NOT_FOUND = Buffer.from([
    0xcf, 0xb5, 0xcd, 0xb3, 0xd5, 0xd2, 0xb2, 0xbb, 0xb5, 0xbd, 0xd6, 0xb8,
    0xb6, 0xa8, 0xb5, 0xc4, 0xce, 0xc4, 0xbc, 0xfe,
  ]);

  it('is platform-honest: ASCII survives everywhere', () => {
    expect(decodeConsoleOutput(Buffer.from('hello world'))).toBe('hello world');
    expect(decodeConsoleOutput(Buffer.alloc(0))).toBe('');
  });

  it('decodes pure UTF-8 text as UTF-8 on any platform', () => {
    const utf8 = Buffer.from('plain ascii result', 'utf-8');
    expect(decodeConsoleOutput(utf8)).toBe('plain ascii result');
  });

  onLegacyCp('decodes GBK bytes on a legacy console without mojibake', () => {
    const out = decodeConsoleOutput(GBK_FILE_NOT_FOUND);
    // The v3.5.0 strict-UTF-8-first order produced garbage here because
    // these GBK bytes also parse as valid UTF-8.
    expect(out.includes('文件') || out.includes('找不到')).toBe(true);
    expect(out).not.toContain('绯荤粺');
  });
});

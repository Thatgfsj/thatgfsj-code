import { describe, it, expect } from 'vitest';
import { isBlockedHost, isAllowedUrl } from '../../src/tools/browser.js';
import { ShellTool } from '../../src/tools/shell.js';

describe('browser SSRF guard: isBlockedHost', () => {
  it.each([
    ['localhost'],
    ['foo.localhost'],
    ['mypc'],                 // no dot => intranet machine name
    ['127.0.0.1'],
    ['127.8.8.8'],
    ['10.1.2.3'],
    ['192.168.1.1'],
    ['172.16.5.4'],
    ['172.31.255.1'],
    ['169.254.169.254'],      // cloud metadata endpoint
    ['0.0.0.0'],
    ['::1'],
    ['fd00::1'],              // IPv6 ULA fc00::/7
    ['fc00::1'],
  ])('blocks %s', (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  it.each([
    ['example.com'],
    ['cn.bing.com'],
    ['8.8.8.8'],
    ['2606:4700::1111'],      // public IPv6, not ULA
  ])('allows %s', (host) => {
    expect(isBlockedHost(host)).toBe(false);
  });
});

describe('browser SSRF guard: isAllowedUrl', () => {
  it('allows public http/https URLs', () => {
    expect(isAllowedUrl('http://example.com')).toBe(true);
    expect(isAllowedUrl('https://example.com/some/path?q=1')).toBe(true);
    expect(isAllowedUrl('https://8.8.8.8/')).toBe(true);
  });

  it('rejects non-http(s) schemes', () => {
    expect(isAllowedUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedUrl('ftp://example.com')).toBe(false);
  });

  it('rejects intranet/loopback targets', () => {
    expect(isAllowedUrl('http://localhost/x')).toBe(false);
    expect(isAllowedUrl('http://127.0.0.1:8080/')).toBe(false);
    expect(isAllowedUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isAllowedUrl('http://[::1]/')).toBe(false);
  });

  it('rejects unparsable input', () => {
    expect(isAllowedUrl('not a url')).toBe(false);
    expect(isAllowedUrl('')).toBe(false);
  });
});

describe('shell dangerous-command segmentation', () => {
  const tool = new ShellTool();
  const confirmYes = async () => true;

  it('blocks a dangerous command chained after a harmless one (&&)', async () => {
    const r = await tool.execute({ command: 'echo ok && rm -rf /' }, { confirmAction: confirmYes });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Blocked');
  });

  it('blocks a dangerous command chained by ; and | and newline', async () => {
    for (const cmd of ['echo ok; rm -rf /', 'echo ok | rm -rf /', 'echo ok\nrm -rf /']) {
      const r = await tool.execute({ command: cmd }, { confirmAction: confirmYes });
      expect(r.success).toBe(false);
      expect(r.error).toContain('Blocked');
    }
  });

  it('does NOT block a quoted "&&" inside echo arguments', async () => {
    // Decline at confirmation so nothing actually executes; reaching the
    // "cancelled" error proves the blacklist did not fire first.
    const r = await tool.execute({ command: 'echo "a && b"' }, { confirmAction: async () => false });
    expect(r.success).toBe(false);
    expect(r.error).not.toContain('Blocked');
    expect(r.error).toContain('cancelled');
  });
});

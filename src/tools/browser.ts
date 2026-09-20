/**
 * Browser Tool - Local browser automation via Playwright (v3.0.13).
 *
 * Lets the agent search the web and read pages using a REAL browser on the
 * user's machine — no API keys, no third-party search service, traffic goes
 * through the local network stack (works in China; Bing/Baidu are direct).
 *
 * Design notes:
 *   - Uses `playwright-core` (≈3MB, no browser downloads) with the BUNDLED
 *     Chromium only (installed via `npx playwright install chromium` on
 *     first run) — the user's own browser is never launched.
 *   - The browser launches lazily on first use and is reused across calls;
 *     it is killed on process exit.
 *   - `search`  : engine search (bing | baidu), returns title/url/snippet
 *   - `open`    : open a URL, return the page's readable text
 *   - `close`   : shut the browser down
 *
 * Read-only (`network` permission): never asks for confirmation.
 */

import type { Tool, ToolContext, ToolResult } from './types.js';
import { URL } from 'node:url';
import { lookup } from 'node:dns/promises';

const GOTO_TIMEOUT_MS = 25000;
const MAX_PAGE_TEXT = 6000;
const MAX_RESULTS = 10;

/**
 * v3.2.1: honor the shell's proxy env (HTTP(S)_PROXY / ALL_PROXY). The
 * user's network often needs a proxy for github.com etc. — Chromium does
 * NOT read those env vars by itself, which is why every external page
 * timed out at 25s. Same precedence style as utils/net (https first).
 */
export function proxyFromEnv(): string | null {
  const keys = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/** Result extractors per search engine — page-local selectors. */
const ENGINES: Record<string, { url: (q: string) => string; results: () => { item: string; title: string; snippet: string } }> = {
  bing: {
    url: (q) => `https://cn.bing.com/search?q=${encodeURIComponent(q)}&mkt=zh-CN`,
    results: () => ({
      item: '#b_results li.b_algo',
      title: 'h2 a',
      snippet: '.b_caption p, p',
    }),
  },
  baidu: {
    url: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
    results: () => ({
      item: '#content_left .result, #content_left .c-container',
      title: 'h3 a',
      snippet: '.c-abstract, [class*=content-right], p',
    }),
  },
};

/**
 * SSRF guard (pure functions, exported for tests).
 *
 * `action=open` must never be turned into a probe of the user's intranet or
 * loopback services: block localhost (incl. *.localhost), bare machine names
 * (no dot in the hostname), loopback/private/link-local IPv4 ranges and
 * IPv6 loopback / ULA (fc00::/7). Only http/https are allowed.
 */

/** True when the hostname must NOT be fetched (loopback / intranet / malformed). */
export function isBlockedHost(hostname: string): boolean {
  // v3.2.2: strip trailing FQDN dots — "127.0.0.1." resolves to 127.0.0.1
  // but evaded every pattern below (SSRF bypass, adversarial audit S1).
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!host) return true;

  // IPv6 (contains ':') — loopback, unspecified and ULA fc00::/7.
  if (host.includes(':')) {
    if (host === '::1' || host === '::' || host === '0:0:0:0:0:0:0:1') return true;
    if (host.startsWith('fc') || host.startsWith('fd')) return true; // fc00::/7 unique local
    // v3.2.2: IPv4-mapped in ANY serialization is loopback-only (audit S2) —
    // Node serializes ::ffff:127.0.0.1 as ::ffff:7f00:1 (hex), which the
    // dotted pattern below never matched.
    if (host.startsWith('::ffff:')) return true;
    return false;
  }

  // localhost and *.localhost always resolve to the local machine.
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  // No dot => intranet machine name (e.g. "mypc", "nas") — refuse.
  if (!host.includes('.')) return true;

  // Dotted-quad IPv4 checks.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8, 10/8, 127/8
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16/12
    if (a === 192 && b === 168) return true;           // 192.168/16
    if (a === 169 && b === 254) return true;           // 169.254/16 link-local
  }
  return false;
}

/** True when the URL is fetchable: parses, is http/https and the host is not blocked. */
export function isAllowedUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const proto = parsed.protocol.toLowerCase();
  if (proto !== 'http:' && proto !== 'https:') return false;
  return !isBlockedHost(parsed.hostname);
}

export class BrowserTool implements Tool {
  name = 'browser';
  description =
    'Drive a local browser (headless built-in Chromium 内置 Chromium via Playwright) to search ' +
    'the web or read pages. Actions: search (query via bing/baidu), open ' +
    '(read a URL as text), close. Use for anything beyond your training ' +
    'data: current events, docs, prices, error messages.';

  inputSchema = {
    type: 'object' as const,
    properties: {
      action: { type: 'string', description: 'Action: search, open, close' },
      query: { type: 'string', description: 'Search keywords (for action=search)' },
      url: { type: 'string', description: 'URL to open (for action=open)' },
      engine: { type: 'string', description: 'Search engine: bing (default) or baidu' },
    },
    required: ['action'],
  };

  metadata = {
    permissions: ['network'] as ('read' | 'write' | 'execute' | 'network')[],
    tags: ['browser', 'web', 'network'],
    version: '1.0.0',
  };

  parameters = [
    { name: 'action', type: 'string', description: 'Action: search, open, close', required: true },
    { name: 'query', type: 'string', description: 'Search keywords (for search)', required: false },
    { name: 'url', type: 'string', description: 'URL to open (for open)', required: false },
    { name: 'engine', type: 'string', description: 'Engine: bing (default) or baidu', required: false },
  ];

  /** Lazily-created, shared across calls. */
  private static pw: any = null;
  private static browser: any = null;
  private static launchError: string | null = null;
  private static exitHookInstalled = false;

  /**
   * v3.0.16: reset a cached launch failure. A failed lazy launch poisons
   * every later call with the stale error string; after the first-run
   * setup installs Chromium successfully, browser-setup calls this so the
   * tool can launch without a restart.
   */
  static clearLaunchError(): void {
    BrowserTool.launchError = null;
  }

  private async launch(): Promise<any> {
    // v3.2.1: liveness check — a cached browser whose process died (crash,
    // OOM killer, manual close) poisoned every later call. 给每次都打上服务:
    // verify the pipe is connected, relaunch when it is not.
    if (BrowserTool.browser) {
      const alive = typeof BrowserTool.browser.isConnected === 'function'
        ? BrowserTool.browser.isConnected()
        : true;
      if (alive) return BrowserTool.browser;
      BrowserTool.browser = null;
    }
    if (BrowserTool.launchError) throw new Error(BrowserTool.launchError);
    // v3.2.2: clear stale failure state BEFORE trying — a transient error
    // (dead proxy process, brief OOM) used to poison the tool until the
    // process restarted even after the user fixed the cause.
    BrowserTool.launchError = null;

    if (!BrowserTool.pw) {
      try {
        BrowserTool.pw = await import('playwright-core');
      } catch (err: any) {
        BrowserTool.launchError = 'playwright-core is not installed. Run: npm i -g playwright-core';
        throw new Error(BrowserTool.launchError);
      }
    }

    // v3.0.14: bundled Chromium ONLY — the user's own browser is never
    // launched (their explicit preference). Chromium is installed via
    // `npx playwright install chromium` in the first-run setup.
    try {
      const proxy = proxyFromEnv();
      BrowserTool.browser = await BrowserTool.pw.chromium.launch({
        headless: true,
        ...(proxy ? { proxy: { server: proxy } } : {}),
      });
    } catch (err: any) {
      // v3.2.2: keep the ORIGINAL reason — a bad HTTPS_PROXY value launches
      // with the same failure signature as a missing Chromium, and the old
      // "run npx playwright install chromium" advice sent users to reinstall
      // 130MB for nothing.
      const reason = err?.message ? ` (${err.message})` : '';
      BrowserTool.launchError =
        'Built-in Chromium (内置 Chromium) failed to launch' + reason +
        '. Check HTTPS_PROXY/HTTP_PROXY if set, or run `gfcode` once and choose ' +
        'to install it (≈130MB), or run manually: npx playwright install chromium';
      throw new Error(BrowserTool.launchError);
    }

    if (!BrowserTool.exitHookInstalled) {
      BrowserTool.exitHookInstalled = true;
      process.on('exit', () => {
        try { BrowserTool.browser?.close(); } catch { /* best-effort */ }
      });
    }
    return BrowserTool.browser;
  }

  /**
   * v3.2.1: navigate with one retry on a BRAND-NEW page (and a relaunched
   * browser when the old one died). First navigation after launch or on a
   * flaky network can wedge the page; the retry gets a fresh service every
   * time instead of surfacing a bare 25s timeout.
   */
  private async gotoWithRetry(browser: any, makePage: (b: any) => Promise<any>, url: string, signal: AbortSignal | undefined): Promise<{ page: any; closeOnAbort: (() => void) | undefined }> {
    let page = await makePage(browser);
    let closeOnAbort = this.bindAbortToPage(signal, page);
    try {
      await page.goto(url, { timeout: GOTO_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
      return { page, closeOnAbort };
    } catch (err: any) {
      const msg = String(err?.message || err);
      // v3.2.2: widened — "browserContext.newPage: Target page, browser or
      // context has been closed" and node-level EHOSTUNREACH/ETIMEDOUT/
      // EPIPE/EPROTO/socket hang up never matched the old pattern and
      // surfaced raw instead of retrying.
      const stale = /Timeout \d+ms exceeded|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|EPIPE|EPROTO|hang up|has been closed|Target closed|Session closed|ERR_/i.test(msg);
      if (!stale) {
        closeOnAbort?.();
        await page.close().catch(() => {});
        throw err;
      }
      // Fresh service: same browser when alive, otherwise a full relaunch.
      closeOnAbort?.();
      await page.close().catch(() => {});
      if (typeof browser.isConnected === 'function' && !browser.isConnected()) {
        await this.dispose();
        browser = await this.launch();
      }
      // v3.2.2 (audit S4): makePage receives the CURRENT browser — the old
      // closure captured the dead one, so a relaunch still called
      // newPage() on the disposed browser and failed identically.
      page = await makePage(browser);
      closeOnAbort = this.bindAbortToPage(signal, page);
      try {
        await page.goto(url, { timeout: GOTO_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
      } catch (retryErr: any) {
        await page.close().catch(() => {});
        closeOnAbort?.();
        // v3.2.2 (audit M2): tell the user WHAT to do — Chromium ignores
        // system proxy settings, so an unproxied terminal needs HTTPS_PROXY.
        const proxy = proxyFromEnv();
        const hint = proxy
          ? `已使用代理 ${proxy} — 请确认代理进程存活且支持 https 流量。`
          : '终端未设置 HTTPS_PROXY — Chromium 不读系统代理，访问 GitHub 等外站请先在终端设置 HTTPS_PROXY。';
        throw new Error(`${String(retryErr?.message || retryErr)}（已自动重试一次仍失败。${hint}）`);
      }
      return { page, closeOnAbort };
    }
  }

  /** Sentinel result for a cancelled call (ctx.signal aborted). */
  private static aborted(): ToolResult {
    return { success: false, error: 'Aborted before the page request started.' };
  }

  async execute(params: Record<string, any>, ctx?: ToolContext): Promise<ToolResult> {
    const action = String(params.action || '').toLowerCase();

    // v3.0.16: honor caller cancellation — bail out immediately when the
    // signal already fired instead of launching a browser for a dead call.
    if (ctx?.signal?.aborted) {
      return BrowserTool.aborted();
    }

    try {
      if (action === 'close') {
        await this.dispose();
        return { success: true, output: 'Browser closed.' };
      }

      if (action === 'search') {
        const query = typeof params.query === 'string' ? params.query.trim() : '';
        if (!query) return { success: false, error: 'query is required for action=search' };
        const engine = ENGINES[String(params.engine || 'bing').toLowerCase()] ? String(params.engine || 'bing').toLowerCase() : 'bing';
        const browser = await this.launch();
        const { page, closeOnAbort } = await this.gotoWithRetry(
          browser,
          (b) => b.newPage(),
          ENGINES[engine].url(query),
          ctx?.signal,
        );
        try {
          await page.waitForSelector(ENGINES[engine].results().item, { timeout: 8000 }).catch(() => {});
          const results: Array<{ title: string; url: string; snippet: string }> = await page.evaluate(
            ({ item, title, snippet }: { item: string; title: string; snippet: string }) => {
              const out: Array<{ title: string; url: string; snippet: string }> = [];
              for (const el of document.querySelectorAll(item)) {
                const a = el.querySelector(title);
                if (!a) continue;
                out.push({
                  title: (a.textContent || '').trim(),
                  url: (a as HTMLAnchorElement).href || '',
                  snippet: (el.querySelector(snippet)?.textContent || '').trim(),
                });
                if (out.length >= 10) break;
              }
              return out;
            },
            ENGINES[engine].results(),
          );
          if (results.length === 0) {
            return { success: false, error: `No results parsed from ${engine} (page structure may have changed). Try engine=baidu or action=open with a direct URL.` };
          }
          const blocks = results.map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet.slice(0, 300)}`);
          return { success: true, output: `${engine} search for "${query}" — ${results.length} results:\n\n${blocks.join('\n\n')}` };
        } finally {
          closeOnAbort?.();
          await page.close().catch(() => {});
        }
      }

      if (action === 'open') {
        const url = typeof params.url === 'string' ? params.url.trim() : '';
        if (!url) return { success: false, error: 'url is required for action=open' };
        let normalized = url;
        if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized;
        if (!isAllowedUrl(normalized)) {
          return { success: false, error: 'blocked: 不允许访问内网/环回地址' };
        }
        // v3.4.0: DNS rebinding protection — resolve the hostname and run
        // EVERY address through the same intranet rules. isBlockedHost only
        // sees the literal hostname; a public domain resolving to
        // 127.0.0.1 / 169.254.x would otherwise sail through.
        try {
          const host = new URL(normalized).hostname;
          const addrs = await lookup(host, { all: true, verbatim: true });
          const bad = addrs.find(a => isBlockedHost(a.address));
          if (bad) {
            return { success: false, error: `blocked: ${host} 解析到 ${bad.address}（内网/环回地址，DNS rebinding 防护）` };
          }
        } catch { /* resolution failure: let page.goto surface the real error */ }
        const browser = await this.launch();
        const { page, closeOnAbort } = await this.gotoWithRetry(
          browser,
          (b) => b.newPage(),
          normalized,
          ctx?.signal,
        );
        try {
          await page.waitForTimeout(500);
          const text = await page.evaluate(() => {
            // Strip the obvious noise before reading text.
            for (const sel of ['script', 'style', 'noscript', 'svg', 'iframe']) {
              for (const el of document.querySelectorAll(sel)) el.remove();
            }
            const root = (document.querySelector('main, article') || document.body) as HTMLElement;
            return root.innerText;
          });
          const clean = text.replace(/\n{3,}/g, '\n\n').trim();
          if (!clean) return { success: false, error: 'Page loaded but no text extracted (may be a JS-only app).' };
          const output = clean.length > MAX_PAGE_TEXT
            ? clean.slice(0, MAX_PAGE_TEXT) + `\n\n... [truncated, ${clean.length - MAX_PAGE_TEXT} more chars — open with a more specific URL if needed]`
            : clean;
          return { success: true, output: `${normalized}\n\n${output}` };
        } finally {
          closeOnAbort?.();
          await page.close().catch(() => {});
        }
      }

      return { success: false, error: `Unknown action: ${action}. Use search, open or close.` };
    } catch (error: any) {
      return { success: false, error: `browser ${action} failed: ${error.message}` };
    }
  }

  /**
   * v3.0.16: tie a page's lifetime to the caller's AbortSignal — when the
   * signal fires mid-navigation the page closes at once, which fails the
   * pending page.goto immediately instead of leaving it running for up to
   * GOTO_TIMEOUT_MS. Returns the detach function for the finally block.
   */
  private bindAbortToPage(signal: AbortSignal | undefined, page: any): (() => void) | undefined {
    if (!signal) return undefined;
    const onAbort = () => {
      try { page.close().catch(() => {}); } catch { /* page already dead */ }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    return () => signal.removeEventListener('abort', onAbort);
  }

  /** Shut the shared browser down (process exit / action=close). */
  async dispose(): Promise<void> {
    const browser = BrowserTool.browser;
    BrowserTool.browser = null;
    if (browser) {
      try { await browser.close(); } catch { /* already dead */ }
    }
  }

  /**
   * v3.0.14: verify the BUNDLED Chromium launches (setup completed).
   * Returns 'chromium' on success, null otherwise. System browsers are
   * intentionally not considered.
   */
  static async verifyLaunch(): Promise<'chromium' | null> {
    try {
      const pw: any = await import('playwright-core');
      const browser = await pw.chromium.launch({ headless: true });
      await browser.close().catch(() => {});
      return 'chromium';
    } catch {
      return null;
    }
  }
}

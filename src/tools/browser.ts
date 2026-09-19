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
 *     first run) — the user's own Edge/Chrome is never launched.
 *   - The browser launches lazily on first use and is reused across calls;
 *     it is killed on process exit.
 *   - `search`  : engine search (bing | baidu), returns title/url/snippet
 *   - `open`    : open a URL, return the page's readable text
 *   - `close`   : shut the browser down
 *
 * Read-only (`network` permission): never asks for confirmation.
 */

import type { Tool, ToolContext, ToolResult } from './types.js';

const GOTO_TIMEOUT_MS = 25000;
const MAX_PAGE_TEXT = 6000;
const MAX_RESULTS = 10;

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

export class BrowserTool implements Tool {
  name = 'browser';
  description =
    'Drive a local browser (headless Edge/Chrome via Playwright) to search ' +
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
    maxDuration: 60000,
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
    if (BrowserTool.browser) return BrowserTool.browser;
    if (BrowserTool.launchError) throw new Error(BrowserTool.launchError);

    if (!BrowserTool.pw) {
      try {
        BrowserTool.pw = await import('playwright-core');
      } catch (err: any) {
        BrowserTool.launchError = 'playwright-core is not installed. Run: npm i -g playwright-core';
        throw new Error(BrowserTool.launchError);
      }
    }

    // v3.0.14: bundled Chromium ONLY — the user's own Edge/Chrome is never
    // launched (their explicit preference). Chromium is installed via
    // `npx playwright install chromium` in the first-run setup.
    try {
      BrowserTool.browser = await BrowserTool.pw.chromium.launch({ headless: true });
    } catch {
      BrowserTool.launchError =
        'Playwright Chromium is not installed yet. Run `gfcode` once and choose ' +
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
        const page = await browser.newPage();
        const closeOnAbort = this.bindAbortToPage(ctx?.signal, page);
        try {
          await page.goto(ENGINES[engine].url(query), { timeout: GOTO_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
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
        const browser = await this.launch();
        const page = await browser.newPage();
        const closeOnAbort = this.bindAbortToPage(ctx?.signal, page);
        try {
          await page.goto(normalized, { timeout: GOTO_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
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
      try { void page.close(); } catch { /* page already dead */ }
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

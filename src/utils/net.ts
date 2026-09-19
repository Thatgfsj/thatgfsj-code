/**
 * Network utilities shared by LLM providers.
 *
 * v3.0.19 hardening after live reports of bare "Error: fetch failed" on
 * SiliconFlow (intermittent resets of the local Clash/mihomo TUN tunnel —
 * DNS hands out fake-IP 198.18.0.0/15 addresses, so when the tunnel core
 * hiccups Node's fetch dies with an opaque TypeError whose real reason
 * hides in `e.cause`):
 *
 * 1. Cause transparency — the wrapped TypeError("fetch failed") is re-thrown
 *    as `fetch failed (ECONNRESET)` etc. so users finally see WHY.
 * 2. Automatic retry — network-layer failures only (see isRetryableError),
 *    exponential backoff 500ms / 1500ms. HTTP 4xx/5xx are NOT retried; they
 *    resolve normally and the caller decides what to do with them.
 * 3. Proxy support — Node's global fetch ignores the system proxy. When
 *    HTTPS_PROXY / https_proxy / HTTP_PROXY / http_proxy is set we route
 *    requests through undici's EnvHttpProxyAgent (honors NO_PROXY as well;
 *    falls back to ProxyAgent on undici builds without it). Set
 *    THATGFSJ_NO_PROXY=1 to force direct connections even when proxy env
 *    vars are present.
 */

export interface FetchWithRetryOptions {
  /** Extra attempts after the first one fails with a network error. Default 2. */
  retries?: number;
  /** Per-attempt timeout in ms (AbortController based). Undefined = no timeout. */
  timeoutMs?: number;
  /** External signal (user cancel / stream watchdog). Aborting never retries. */
  signal?: AbortSignal;
}

/** Non-retryable transport failures: retrying a broken certificate chain cannot succeed. */
const NON_RETRYABLE_CODE_PATTERNS = [/^CERT_[A-Z_]+$/, /^ERR_TLS/, /^ERR_SSL/, /^UNABLE_TO_VERIFY_LEAF_SIGNATURE$/];

/** Transient socket/DNS level codes worth a second attempt. */
const RETRYABLE_NET_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/**
 * Decide whether an error thrown by fetch is a transient network-layer
 * failure worth retrying. HTTP 4xx/5xx never reach this function (fetch
 * resolves those), so "API error 401" style Errors from callers are
 * naturally not retryable.
 *
 * Note: AbortError is treated as retryable here (it usually means our own
 * per-attempt timeout fired); genuine external cancellation is filtered out
 * by fetchWithRetry BEFORE this check runs.
 */
export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;

  if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
    const code = (err.cause as any)?.code;
    if (typeof code === 'string') {
      if (NON_RETRYABLE_CODE_PATTERNS.some(re => re.test(code))) return false;
      return true; // ECONNRESET / ETIMEDOUT / UND_ERR_* / unknown socket errors
    }
    return true; // bare "fetch failed" with no cause detail: assume transient
  }

  const code = (err as any).code ?? (err.cause as any)?.code;
  if (typeof code === 'string') {
    if (NON_RETRYABLE_CODE_PATTERNS.some(re => re.test(code))) return false;
    if (code.startsWith('UND_ERR')) return true; // undici connect/headers/body timeouts
    return RETRYABLE_NET_CODES.has(code);
  }

  return false;
}

/**
 * Human-readable reason for a failed fetch, taken from the underlying cause
 * (Node puts the real error there — ECONNRESET, ETIMEDOUT, certificate
 * failures, ...). Returns '' when nothing useful is attached.
 */
export function describeFetchCause(err: unknown): string {
  if (!(err instanceof Error)) return '';
  const cause = (err.cause ?? (err as any).cause) as any;
  if (!cause) return '';
  if (typeof cause === 'string') return cause;
  return String(cause.code || cause.message || cause);
}

/**
 * Wrap the infamous TypeError("fetch failed") into an Error that surfaces
 * the underlying cause, e.g. `fetch failed (ECONNRESET) after 3 attempts`.
 * The original error is preserved on `.cause`. Any other error is returned
 * untouched.
 */
export function enrichFetchError(err: unknown, attempts = 1): Error {
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
    const detail = describeFetchCause(err);
    const suffix = attempts > 1 ? ` after ${attempts} attempts` : '';
    const wrapped: Error = new Error(`fetch failed${detail ? ` (${detail})` : ''}${suffix}`);
    (wrapped as any).cause = err;
    return wrapped;
  }
  return err as Error;
}

function backoffDelayMs(attempt: number): number {
  // 500ms, 1500ms, 4500ms... (spec: 500/1500 for the default 2 retries)
  return 500 * Math.pow(3, attempt);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function externalAbortError(signal: AbortSignal): Error {
  const reason = (signal as any).reason;
  if (reason instanceof Error) return reason;
  return new DOMException('This operation was aborted', 'AbortError');
}

// ---------------------------------------------------------------------------
// Proxy dispatcher (undici EnvHttpProxyAgent / ProxyAgent)
// ---------------------------------------------------------------------------

let dispatcherPromise: Promise<any | undefined> | undefined;

/** Drop the cached dispatcher so the next request re-reads proxy env vars. Exported for tests. */
export function resetProxyDispatcherCache(): void {
  dispatcherPromise = undefined;
}

function firstProxyEnvValue(): string | undefined {
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    const v = process.env[key];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Resolve the undici dispatcher for the current proxy env vars.
 * Returns undefined when no proxy is configured, the user opted out via
 * THATGFSJ_NO_PROXY, or undici is unavailable (fail-open to direct fetch).
 */
async function resolveProxyDispatcher(): Promise<any | undefined> {
  if (process.env.THATGFSJ_NO_PROXY && process.env.THATGFSJ_NO_PROXY !== '0') return undefined;
  const proxyUrl = firstProxyEnvValue();
  if (!proxyUrl) return undefined;

  if (!dispatcherPromise) {
    dispatcherPromise = (async () => {
      try {
        const mod: any = await import('undici');
        const self = mod.default ?? mod;
        // EnvHttpProxyAgent reads HTTP_PROXY/HTTPS_PROXY/NO_PROXY itself and
        // handles per-host NO_PROXY exceptions; ProxyAgent is the plain fallback.
        const AgentCtor = self.EnvHttpProxyAgent ?? mod.EnvHttpProxyAgent;
        if (typeof AgentCtor === 'function') return new AgentCtor();
        const ProxyAgentCtor = self.ProxyAgent ?? mod.ProxyAgent;
        if (typeof ProxyAgentCtor === 'function') return new ProxyAgentCtor(proxyUrl);
        return undefined;
      } catch {
        return undefined; // undici missing → direct connection, best effort
      }
    })();
  }
  return dispatcherPromise;
}

/**
 * fetch() with automatic retry for network-layer failures and proxy support.
 *
 * - Retries: TypeError("fetch failed") / AbortError from our own timeout /
 *   undici UND_ERR_* / transient socket codes. Exponential backoff 500ms,
 *   1500ms. HTTP 4xx/5xx resolve normally and are NEVER retried here.
 * - External signal: passed through untouched; aborting it cancels the
 *   in-flight attempt and any pending backoff without retrying.
 * - Timeout: per-attempt (each try gets a fresh timeoutMs window).
 * - init.body must be a string/Buffer/URLSearchParams (reusable across
 *   attempts) — required for the POST JSON bodies LLM providers send.
 *
 * On final failure a TypeError("fetch failed") is re-thrown via
 * enrichFetchError so the user sees `fetch failed (ECONNRESET)` instead of
 * a bare "fetch failed".
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const retries = options.retries ?? 2;

  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) throw externalAbortError(options.signal);

    const attemptController = new AbortController();
    let timedOut = false;
    const timer =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            attemptController.abort();
          }, options.timeoutMs)
        : undefined;

    try {
      const signal = options.signal
        ? AbortSignal.any([attemptController.signal, options.signal])
        : attemptController.signal;

      const requestInit: any = { ...init, signal };
      const dispatcher = await resolveProxyDispatcher();
      if (dispatcher !== undefined) requestInit.dispatcher = dispatcher;

      return await globalThis.fetch(url, requestInit);
    } catch (err) {
      // 1. External cancellation: never retry, surface the signal's reason.
      if (options.signal?.aborted) throw externalAbortError(options.signal);

      // 2. Our own per-attempt timeout fired: retryable, but reword the error
      //    on exhaustion (an AbortError named "The operation was aborted"
      //    tells the user nothing).
      if (timedOut) {
        if (attempt >= retries) {
          throw new Error(`request timed out after ${options.timeoutMs}ms (${attempt + 1} attempt${attempt ? 's' : ''})`);
        }
      } else if (!isRetryableError(err) || attempt >= retries) {
        throw enrichFetchError(err, attempt + 1);
      }

      await sleep(backoffDelayMs(attempt), options.signal);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchWithRetry,
  isRetryableError,
  enrichFetchError,
  resetProxyDispatcherCache,
} from '../../src/utils/net.js';

/**
 * Pure-logic / mock-fetch tests only: no real network is touched.
 */

function networkError(code: string): TypeError {
  const cause = new Error(code);
  (cause as any).code = code;
  return new TypeError('fetch failed', { cause });
}

function okResponse(body = '{"ok":true}', status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.HTTPS_PROXY;
  delete process.env.https_proxy;
  delete process.env.HTTP_PROXY;
  delete process.env.http_proxy;
  delete process.env.THATGFSJ_NO_PROXY;
  resetProxyDispatcherCache();
});

describe('isRetryableError: retry decision', () => {
  it('retries TypeError fetch failed with a socket cause', () => {
    expect(isRetryableError(networkError('ECONNRESET'))).toBe(true);
    expect(isRetryableError(networkError('ETIMEDOUT'))).toBe(true);
  });

  it('retries bare TypeError fetch failed without cause detail', () => {
    expect(isRetryableError(new TypeError('fetch failed'))).toBe(true);
  });

  it('retries undici UND_ERR_* and transient socket codes', () => {
    const undiciErr = new Error('connect timeout');
    (undiciErr as any).code = 'UND_ERR_CONNECT_TIMEOUT';
    expect(isRetryableError(undiciErr)).toBe(true);

    const socketErr = new Error('dns fail');
    (socketErr as any).code = 'EAI_AGAIN';
    expect(isRetryableError(socketErr)).toBe(true);
  });

  it('retries AbortError (our own per-attempt timeout)', () => {
    expect(isRetryableError(new DOMException('Aborted', 'AbortError'))).toBe(true);
  });

  it('does NOT retry TLS/CERT failures (deterministic)', () => {
    expect(isRetryableError(networkError('ERR_TLS_CERT_ALTNAME_INVALID'))).toBe(false);
    expect(isRetryableError(networkError('CERT_HAS_EXPIRED'))).toBe(false);
  });

  it('does NOT retry HTTP-level or unrelated errors', () => {
    expect(isRetryableError(new Error('API error 401: bad key'))).toBe(false);
    expect(isRetryableError(new Error('Stream stalled'))).toBe(false);
    expect(isRetryableError('nope')).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});

describe('enrichFetchError: cause transparency', () => {
  it('appends the cause code: fetch failed (ECONNRESET)', () => {
    const enriched = enrichFetchError(networkError('ECONNRESET'));
    expect(enriched).toBeInstanceOf(Error);
    expect(enriched.message).toBe('fetch failed (ECONNRESET)');
    expect((enriched as any).cause).toBeInstanceOf(TypeError);
  });

  it('mentions the attempt count on exhausted retries', () => {
    expect(enrichFetchError(networkError('ETIMEDOUT'), 3).message).toBe('fetch failed (ETIMEDOUT) after 3 attempts');
    expect(enrichFetchError(new TypeError('fetch failed'), 2).message).toBe('fetch failed after 2 attempts');
  });

  it('leaves non-fetch-failed errors untouched', () => {
    const e = new Error('API error 401: unauthorized');
    expect(enrichFetchError(e)).toBe(e);
  });
});

describe('fetchWithRetry: retry count and backoff (mocked fetch)', () => {
  it('succeeds after transient failures and retries the expected number of times', async () => {
    const mock = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockRejectedValueOnce(networkError('ECONNRESET'))
      .mockRejectedValueOnce(networkError('ECONNRESET'))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', mock);

    const t0 = Date.now();
    const res = await fetchWithRetry('https://x.invalid/v1/chat', { method: 'POST', body: '{}' });
    const elapsed = Date.now() - t0;

    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries (default)
    // backoff: 500ms + 1500ms
    expect(elapsed).toBeGreaterThanOrEqual(1900);
  });

  it('throws the enriched error after exhausting retries', async () => {
    const mock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockRejectedValue(networkError('ETIMEDOUT'));
    vi.stubGlobal('fetch', mock);

    await expect(fetchWithRetry('https://x.invalid', {}, { retries: 1 })).rejects.toThrow(
      'fetch failed (ETIMEDOUT) after 2 attempts',
    );
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('retries:0 means a single attempt', async () => {
    const mock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockRejectedValue(networkError('ECONNRESET'));
    vi.stubGlobal('fetch', mock);

    await expect(fetchWithRetry('https://x.invalid', {}, { retries: 0 })).rejects.toThrow('fetch failed (ECONNRESET)');
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry HTTP 4xx/5xx — the response is returned for the caller', async () => {
    const mock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(okResponse('denied', 500));
    vi.stubGlobal('fetch', mock);

    const res = await fetchWithRetry('https://x.invalid', {});
    expect(res.status).toBe(500);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('passes url and init through to fetch', async () => {
    const mock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', mock);

    await fetchWithRetry('https://x.invalid/v1/chat', { method: 'POST', headers: { Authorization: 'Bearer k' }, body: '{"a":1}' });
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe('https://x.invalid/v1/chat');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer k' });
    expect(init.body).toBe('{"a":1}');
  });
});

describe('fetchWithRetry: external signal pass-through', () => {
  it('throws immediately when the signal is already aborted (no fetch call)', async () => {
    const mock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', mock);

    const controller = new AbortController();
    controller.abort();

    await expect(fetchWithRetry('https://x.invalid', {}, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(mock).not.toHaveBeenCalled();
  });

  it('does not retry when aborted while waiting in backoff', async () => {
    const mock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockRejectedValue(networkError('ECONNRESET'));
    vi.stubGlobal('fetch', mock);

    const controller = new AbortController();
    const promise = fetchWithRetry('https://x.invalid', {}, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20); // during the 500ms backoff window

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchWithRetry: per-attempt timeout', () => {
  it('retries on timeout and rewords the final error', async () => {
    // Mimic real fetch semantics: aborting the signal rejects the in-flight promise.
    const mock = vi.fn(
      (_url: any, init: any) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }),
    );
    vi.stubGlobal('fetch', mock);

    await expect(fetchWithRetry('https://x.invalid', {}, { retries: 1, timeoutMs: 30 })).rejects.toThrow(
      'request timed out after 30ms (2 attempts)',
    );
    expect(mock).toHaveBeenCalledTimes(2);
  }, 10000);
});

describe('proxy env support', () => {
  it('attaches a dispatcher when HTTPS_PROXY is set', async () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7897';
    resetProxyDispatcherCache();

    const mock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', mock);

    await fetchWithRetry('https://x.invalid', {});
    const init: any = mock.mock.calls[0][1];
    expect(init.dispatcher).toBeDefined(); // undici EnvHttpProxyAgent instance
  });

  it('THATGFSJ_NO_PROXY=1 opts out even when proxy env vars exist', async () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7897';
    process.env.THATGFSJ_NO_PROXY = '1';
    resetProxyDispatcherCache();

    const mock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', mock);

    await fetchWithRetry('https://x.invalid', {});
    const init: any = mock.mock.calls[0][1];
    expect(init.dispatcher).toBeUndefined();
  });

  it('no dispatcher when no proxy env vars are set', async () => {
    const mock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', mock);

    await fetchWithRetry('https://x.invalid', {});
    const init: any = mock.mock.calls[0][1];
    expect(init.dispatcher).toBeUndefined();
  });
});

/**
 * OpenAI-compatible Provider
 * Works with: OpenAI, SiliconFlow, DeepSeek, Kimi, Zhipu, MiniMax, Baichuan, Stepfun, Doubao, Ollama, ERNIE
 * Also works with any OpenAI-compatible relay station (中转站)
 *
 * v3.0.0+: caching-friendly wire format
 *   - StreamChunk is now imported from ../types (single source of truth)
 *   - buildRequest uses stableStringify so that the bytes sent are byte-equal
 *     between requests with the same logical payload (required for DeepSeek
 *     automatic prefix-cache hit)
 *   - cache_control on individual ChatMessage is forwarded (Anthropic-style
 *     markers are no-ops on OpenAI-compatible APIs but harmless)
 *   - chatStream yields a final { type: 'usage' } chunk if the upstream
 *     returned usage info (stream_options.include_usage already requested)
 */

import type { ChatMessage, ChatResponse, ChatOptions, ToolCall, StreamChunk } from '../types.js';
import type { Tool } from '../tools/types.js';
import type { LLMProvider, ProviderConfig } from './provider.js';
import { stableStringify } from '../utils/stableStringify.js';
import { fetchWithRetry } from '../utils/net.js';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  buildTools(tools: Tool[]): any[] {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema || {
          type: 'object',
          properties: Object.fromEntries(
            tool.parameters.map(p => [p.name, { type: p.type, description: p.description }])
          ),
          required: tool.parameters.filter(p => p.required).map(p => p.name),
        },
      },
    }));
  }

  async chat(messages: ChatMessage[], options?: ChatOptions, tools?: Tool[]): Promise<ChatResponse> {
    const body = this.buildRequest(messages, false, options, tools);
    const response = await this.doRequest(body, options?.signal);

    // v3.0.5: non-streaming path never checked response.ok — a 401/429 body
    // was silently parsed into an empty ChatResponse.
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`API error ${response.status}: ${text.slice(0, 500)}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    // v3.5.4 (field report): `choices: []` used to parse to an empty
    // success.
    if (!choice) {
      throw new Error('Provider returned a malformed response (no choices). This is a provider-side failure, not an empty answer.');
    }

    return {
      content: choice?.message?.content || '',
      role: 'assistant',
      usage: data.usage ? this.normalizeUsage(data.usage) : undefined,
      tool_calls: choice?.message?.tool_calls,
    };
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions, tools?: Tool[]): AsyncGenerator<StreamChunk, ChatResponse> {
    const body = this.buildRequest(messages, true, options, tools);

    // v3.0.5: idle watchdog. The 60s connect timeout in doRequest only covers
    // until the response headers arrive; a stalled stream afterwards would
    // hang forever. Abort if no bytes arrive for 120s.
    const controller = new AbortController();
    const upstream = options?.signal;
    const onUpstreamAbort = () => controller.abort();
    upstream?.addEventListener('abort', onUpstreamAbort, { once: true });
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), 120000);
    };
    resetIdle();

    let fullContent = '';
    let buffer = '';
    // Accumulate streaming tool call chunks
    const toolCallBuffers: Map<number, { id: string; name: string; arguments: string }> = new Map();
    // Some providers attach usage only on the last chunk (DeepSeek / OpenAI with
    // stream_options.include_usage). We capture it here and yield at the end.
    let capturedUsage: ChatResponse['usage'] | undefined;
    // v3.5.3 (field report): a 200 response whose body is garbage (non-SSE
    // HTML, truncated JSON, an error page) used to parse to NOTHING while
    // every invalid line was silently skipped — the agent loop then treated
    // the empty result as a successful completion (success:true, content:"").
    // Track whether at least one valid SSE frame arrived.
    let sawValidFrame = false;
    // v3.5.4 (field report): a stream with SOME valid frames but no finish
    // frame (truncated mid-stream) also read as an empty success.
    let sawFinish = false;

    try {
      // v3.5.4 (field report P2): honor Retry-After on 429 — the report
      // measured a 450ms blind failure against a server asking to wait.
      // Wait up to 30s and retry once.
      let response = await this.doRequest(body, controller.signal);
      if (response.status === 429) {
        const ra = Number(response.headers.get('retry-after'));
        const waitSec = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) : 0;
        if (waitSec > 0) {
          // v3.5.5: say when the wait was capped, so a 120s request reading
          // as 30s doesn't look like we ignored the server.
          if (ra > 30) {
            process.stderr.write(`[llm] 429 Retry-After 为 ${ra}s，超过 30s 上限——等待 30s 后重试一次（不保证成功）\n`);
          }
          await new Promise(r => setTimeout(r, waitSec * 1000));
          response = await this.doRequest(body, controller.signal);
        }
      }
      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new Error(`API error ${response.status}: ${text.slice(0, 500)}`);
      }
      resetIdle();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          resetIdle();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed === 'data: [DONE]') continue;
            if (!trimmed.startsWith('data: ')) continue;

            try {
              const data = JSON.parse(trimmed.slice(6));
              if (Array.isArray(data.choices)) sawValidFrame = true;
              if (data.choices?.[0]?.finish_reason) sawFinish = true;
              const delta = data.choices?.[0]?.delta;

              // Text content
              if (delta?.content) {
                fullContent += delta.content;
                yield { type: 'text', content: delta.content };
              }

              // Streaming tool calls - accumulate chunks
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!toolCallBuffers.has(idx)) {
                    toolCallBuffers.set(idx, { id: '', name: '', arguments: '' });
                  }
                  const buf = toolCallBuffers.get(idx)!;
                  if (tc.id) buf.id = tc.id;
                  if (tc.function?.name) buf.name += tc.function.name;
                  if (tc.function?.arguments) buf.arguments += tc.function.arguments;
                }
              }

              // DeepSeek/OpenAI stream-end usage (only present on the last chunk)
              if (data.usage) {
                capturedUsage = this.normalizeUsage(data.usage);
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        upstream?.removeEventListener('abort', onUpstreamAbort);
        reader.releaseLock();
      }
    } catch (error: any) {
      if (idleTimer) clearTimeout(idleTimer);
      upstream?.removeEventListener('abort', onUpstreamAbort);
      if (controller.signal.aborted && !upstream?.aborted) {
        throw new Error('Stream stalled: no data received for 120s');
      }
      throw error;
    }

    // Convert accumulated tool call buffers to ToolCall[]
    const toolCalls: ToolCall[] = [];
    for (const [, buf] of toolCallBuffers) {
      if (buf.id && buf.name) {
        toolCalls.push({
          id: buf.id,
          type: 'function',
          function: { name: buf.name, arguments: buf.arguments },
        });
      }
    }

    // v3.5.3: fail loudly on an empty/garbage body instead of reporting an
    // empty success.
    // v3.5.4: zero valid frames = garbage body; valid frames but no finish
    // frame = truncated mid-stream. Neither is an "empty answer".
    if (!sawValidFrame || !sawFinish) {
      throw new Error(
        sawValidFrame
          ? 'Provider stream ended without a finish frame (truncated response). This is a provider-side failure, not an empty answer.'
          : 'Provider returned an empty or malformed response body (no valid SSE frames). This is a provider-side failure, not an empty answer.',
      );
    }

    if (toolCalls.length > 0) {
      yield { type: 'tool_calls', toolCalls };
    }

    // Yield captured usage so TUI / cache stats can observe cache hits
    if (capturedUsage) {
      yield { type: 'usage', usage: capturedUsage };
    }

    return {
      content: fullContent,
      role: 'assistant',
      usage: capturedUsage,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  /**
   * Build the request body for OpenAI-compatible API.
   *
   * Why stableStringify matters: DeepSeek (and most OpenAI-compatible APIs)
   * perform automatic prefix cache lookup by byte-level hash of the request
   * payload. If the JSON we send today differs from yesterday's by even one
   * reordered key, the cache misses. Insertion-order stability is good enough
   * when the same code path runs every time, but we now use stableStringify
   * as a belt-and-suspenders guarantee against accidental key reordering from
   * future refactors (spread / Object.fromEntries / map merging).
   */
  protected buildRequest(messages: ChatMessage[], stream: boolean, options?: ChatOptions, tools?: Tool[]) {
    // v3.0.5 fix (found in live testing on SiliconFlow/Qwen): strict
    // OpenAI-compatible providers reject mid-conversation system messages
    // ("System message must be at the beginning", code 20015). Our
    // [TOOL_REPAIR] append-only design adds them after tool failures, so on
    // the wire any system message after the first is downgraded to a user
    // message with a `[system note]` prefix — semantically equivalent for
    // the model and accepted everywhere.
    let seenSystem = false;
    const body: any = {
      model: this.config.model,
      messages: messages.map(m => {
        if (m.role === 'system') {
          if (!seenSystem) {
            seenSystem = true;
            return { role: 'system', content: m.content };
          }
          const text = typeof m.content === 'string'
            ? m.content
            : m.content.filter(b => b.type === 'text').map(b => (b as any).text).join('');
          return { role: 'user', content: `[system note] ${text}` };
        }
        return {
          role: m.role,
          // content is string | ContentBlock[]. OpenAI wire format accepts both:
          // - string for plain text messages
          // - array of {type,text} or {type,image_url} blocks for multimodal
          content: m.content,
          ...(m.name && { name: m.name }),
          ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
          ...(m.tool_calls && { tool_calls: m.tool_calls }),
        };
      }),
      temperature: options?.temperature ?? this.config.temperature,
      max_tokens: options?.maxTokens ?? this.config.maxTokens,
      stream,
      ...(stream && { stream_options: { include_usage: true } }),
      // v3.0.8: thinking effort. Only sent when the user opted in for this
      // model ('off' sends nothing — unknown params can 400 on strict
      // providers). reasoning_effort is the OpenAI-standard field;
      // enable_thinking is the SiliconFlow/Qwen3.5 field.
      ...(options?.thinking && options.thinking !== 'off' && {
        reasoning_effort: options.thinking,
        enable_thinking: true,
      }),
    };

    // Add tools if provided - this is critical for structured tool calling
    if (tools && tools.length > 0) {
      body.tools = this.buildTools(tools);
    }

    return body;
  }

  /**
   * Execute the HTTP request. Serializes via stableStringify so the byte
   * sequence is deterministic across requests.
   *
   * v3.0.5: accepts an external AbortSignal (combined with the 60s connect
   * timeout via AbortSignal.any) so caller-side cancellation and the
   * streaming idle watchdog can kill the request.
   *
   * v3.0.19: goes through fetchWithRetry (see utils/net.ts) which
   *   - surfaces the real failure reason instead of bare "fetch failed"
   *     (e.g. "fetch failed (ECONNRESET)"), and
   *   - automatically retries transient network-layer errors (500ms/1500ms
   *     backoff, 2 extra attempts). HTTP 4xx/5xx are returned untouched for
   *     the caller to handle; external aborts are never retried.
   */
  protected async doRequest(body: any, external?: AbortSignal): Promise<Response> {
    const url = `${this.config.baseUrl}/chat/completions`;
    return fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // v3.4.2: keyless providers (Ollama) get NO auth header — an empty
          // "Bearer " is noise some local servers reject.
          ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
        },
        body: stableStringify(body),
      },
      { retries: 2, timeoutMs: 60000, signal: external }, // 60s connect timeout per attempt
    );
  }

  /**
   * Map upstream usage JSON to the canonical Usage shape. Different providers
   * attach different cache-related fields; we pass everything through so the
   * cache stats layer can interpret per-provider.
   */
  protected normalizeUsage(raw: any): ChatResponse['usage'] {
    return {
      prompt_tokens: raw.prompt_tokens || 0,
      completion_tokens: raw.completion_tokens || 0,
      total_tokens: raw.total_tokens || 0,
      // DeepSeek automatic prefix cache fields
      prompt_cache_hit_tokens: raw.prompt_cache_hit_tokens,
      prompt_cache_miss_tokens: raw.prompt_cache_miss_tokens,
      // Anthropic prompt cache fields (passed through if relay forwards them)
      cache_creation_input_tokens: raw.cache_creation_input_tokens,
      cache_read_input_tokens: raw.cache_read_input_tokens,
      // v3.4.10: OpenAI-compatible automatic prefix caching. zhipu,
      // SiliconFlow, OpenAI and vLLM all report hits here — dropping this
      // field recorded every hit as 0 and made the hit-rate read ~3%.
      cached_tokens:
        raw.prompt_tokens_details?.cached_tokens ??
        raw.cached_tokens ??
        undefined,
    };
  }
}

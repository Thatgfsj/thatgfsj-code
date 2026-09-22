/**
 * Anthropic Provider
 * Works with: Anthropic Claude API
 * Also works with any Anthropic-compatible relay station (中转站)
 *
 * API: POST {baseUrl}/messages
 * Auth: x-api-key: {apiKey}, anthropic-version: 2023-06-01
 * Streaming: SSE with "event: ..." and "data: {...}" lines
 *
 * Key differences from OpenAI:
 * - System message is separate (top-level "system" field, an array of blocks)
 * - No "system" role in messages array
 * - Tool use blocks have type "tool_use" with "input" (not "arguments")
 * - Tool results use role "tool_result" (not "tool")
 *
 * v3.0.0: prompt caching support
 *   - The top-level "system" field is now an array of content blocks. The
 *     last block carries cache_control: { type: 'ephemeral', ttl: '5m' }
 *     by default, so Anthropic caches the entire system prefix across rounds.
 *     The previous buildRequest silently dropped any system messages after
 *     the first (`find` + `system` string) — that bug was fixed in v3.0.0
 *     by forwarding every system message.
 * v3.0.18: mid-stream system inlining
 *   - Only the FIRST system message stays top-level; every LATER system
 *     message ([TOOL_REPAIR] notes appended round over round) is inlined
 *     in place as a user turn tagged '[system note] '. Accumulating those
 *     notes at the tail of the top-level system array used to shift the
 *     cache prefix every round and re-bill the whole system + tools.
 *   - When the resolved TTL is '1h', doRequest opts into the
 *     extended-cache-ttl-2025-04-11 beta so 1h breakpoints are honored.
 *   - The last tool definition gets a cache_control marker too, so tool
 *     schemas are cached on subsequent rounds (Anthropic charges full price
 *     for uncached tool descriptions, which can be the largest single block
 *     in tool-heavy sessions).
 *   - The stream's trailing message_delta carries a `usage` object with
 *     cache_creation_input_tokens / cache_read_input_tokens. We yield a
 *     structured { type: 'usage' } chunk so the cache stats layer can
 *     record hit-rates.
 *   - JSON serialization uses stableStringify so the byte sequence of the
 *     request body is deterministic across rounds. Although Anthropic does
 *     not do byte-level prefix cache (it relies on its own fingerprint),
 *     deterministic serialization makes the on-the-wire body easy to diff
 *     when debugging cache misses.
 */

import type { ChatMessage, ChatResponse, ChatOptions, ToolCall, StreamChunk, Usage } from '../types.js';
import type { Tool } from '../tools/types.js';
import type { LLMProvider, ProviderConfig } from './provider.js';
import { stableStringify } from '../utils/stableStringify.js';

/** Default TTL for cache_control breakpoints. '5m' is cheaper to write; '1h' is preferred when sessions are long. */
const DEFAULT_CACHE_TTL: '5m' | '1h' = '5m';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  protected config: ProviderConfig;
  /**
   * v3.0.3: TTL resolved from the user's config + smart routing. This is
   * the *actual* TTL attached to every cache_control marker we send this
   * session. Stays stable across rounds to keep the Anthropic cache
   * prefix intact.
   *
   * Computed once by LLMService.chatStream when ttl='auto', then
   * persisted via setResolvedTTL. Subsequent rounds call chatStream
   * without re-deciding (ChatOptions.resolvedTtl is sticky per session).
   */
  protected resolvedTtl: '5m' | '1h' = DEFAULT_CACHE_TTL;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /**
   * Called by LLMService after decideTTL(). Persists the TTL on the
   * provider instance so buildRequest() writes it consistently across
   * every round in this session.
   */
  setResolvedTTL(ttl: '5m' | '1h'): void {
    this.resolvedTtl = ttl;
  }

  buildTools(tools: Tool[]): any[] {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema || {
        type: 'object',
        properties: Object.fromEntries(
          tool.parameters.map(p => [p.name, { type: p.type, description: p.description }])
        ),
        required: tool.parameters.filter(p => p.required).map(p => p.name),
      },
    }));
  }

  async chat(messages: ChatMessage[], options?: ChatOptions, tools?: Tool[]): Promise<ChatResponse> {
    const body = this.buildRequest(messages, false, options, tools);
    const response = await this.doRequest(body, options?.signal);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Anthropic API error ${response.status}: ${text.slice(0, 500)}`);
    }

    const data = await response.json();

    // Extract text content
    const textBlocks = data.content?.filter((b: any) => b.type === 'text') || [];
    const content = textBlocks.map((b: any) => b.text).join('');

    // Extract tool calls
    const toolUseBlocks = data.content?.filter((b: any) => b.type === 'tool_use') || [];
    const toolCalls = toolUseBlocks.length > 0 ? toolUseBlocks.map((b: any) => ({
      id: b.id,
      type: 'function' as const,
      function: {
        name: b.name,
        arguments: JSON.stringify(b.input),
      },
    })) : undefined;

    return {
      content,
      role: 'assistant',
      usage: data.usage ? this.normalizeUsage(data.usage) : undefined,
      tool_calls: toolCalls,
    };
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions, tools?: Tool[]): AsyncGenerator<StreamChunk, ChatResponse> {
    const body = this.buildRequest(messages, true, options, tools);

    // v3.0.5: idle watchdog + caller cancellation (same as OpenAI provider).
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
    // Track tool use blocks
    const toolUseBlocks: Map<number, { id: string; name: string; input: string }> = new Map();
    let currentBlockIndex = -1;
    let currentBlockType = '';
    // Anthropic attaches usage info to the trailing message_delta event.
    let capturedUsage: Usage | undefined;
    // v3.5.3 (field report): garbage 200 bodies must fail loudly, not
    // masquerade as an empty-but-successful answer.
    let sawValidFrame = false;
    // v3.5.4: message_stop / stop_reason marks a complete stream — valid
    // frames without one mean the stream was truncated mid-answer.
    let sawFinish = false;

    try {
      const response = await this.doRequest(body, controller.signal);
      resetIdle();

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new Error(`Anthropic API error ${response.status}: ${text.slice(0, 500)}`);
      }

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
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            try {
              const data = JSON.parse(trimmed.slice(6));
              if (data && typeof data === 'object') sawValidFrame = true;
              if (data.type === 'message_stop' || data.delta?.stop_reason) sawFinish = true;

              // content_block_start: track block types
              if (data.type === 'content_block_start') {
                currentBlockIndex = data.index ?? 0;
                currentBlockType = data.content_block?.type || '';
                if (currentBlockType === 'tool_use') {
                  toolUseBlocks.set(currentBlockIndex, {
                    id: data.content_block.id || '',
                    name: data.content_block.name || '',
                    input: '',
                  });
                } else if (currentBlockType === 'thinking') {
                  // Anthropic extended thinking: emit as structured thinking chunks.
                  // TUI / session layer decides whether to surface these.
                  // (We don't push to fullContent — compressThinking strips
                  // these blocks from persistence.)
                }
              }

              // content_block_delta: incremental text or tool input
              if (data.type === 'content_block_delta') {
                if (data.delta?.type === 'text_delta') {
                  const text = data.delta.text;
                  fullContent += text;
                  yield { type: 'text', content: text };
                } else if (data.delta?.type === 'input_json_delta') {
                  const buf = toolUseBlocks.get(currentBlockIndex);
                  if (buf) {
                    buf.input += data.delta.partial_json || '';
                  }
                } else if (data.delta?.type === 'thinking_delta') {
                  if (data.delta.thinking) {
                    yield { type: 'thinking', content: data.delta.thinking };
                  }
                }
              }

              // message_delta carries the final usage (cache hit/miss stats).
              if (data.type === 'message_delta' && data.usage) {
                capturedUsage = this.normalizeUsage({
                  ...capturedUsage,
                  ...data.usage,
                });
              }

              // message_start may carry the initial input_tokens + cache info
              // when prompt caching is active.
              if (data.type === 'message_start' && data.message?.usage) {
                capturedUsage = this.normalizeUsage(data.message.usage);
              }
            } catch {
              // Skip invalid JSON
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

    // Convert tool use blocks to ToolCall[]
    const toolCalls: ToolCall[] = [];
    for (const [, buf] of toolUseBlocks) {
      if (buf.id && buf.name) {
        toolCalls.push({
          id: buf.id,
          type: 'function',
          function: { name: buf.name, arguments: buf.input },
        });
      }
    }

    if (toolCalls.length > 0) {
      yield { type: 'tool_calls', toolCalls };
    }

    // v3.5.3: garbage 200 body (no valid SSE frames) fails loudly.
    // v3.5.4: valid frames but no message_stop = truncated mid-answer.
    if (!sawValidFrame || !sawFinish) {
      throw new Error(
        sawValidFrame
          ? 'Anthropic stream ended without a message_stop frame (truncated response). This is a provider-side failure, not an empty answer.'
          : 'Anthropic API returned an empty or malformed response body (no valid SSE frames). This is a provider-side failure, not an empty answer.',
      );
    }

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
   * Build request body for Anthropic API.
   *
   * v3.0.0 changes:
   *   1. `system` is now an array of content blocks (was a single string).
   *   2. ALL system messages are forwarded (the previous code used `find`
   *      and dropped every system message after the first, which broke
   *      `[Earlier conversation...]` summaries).
   *   3. The LAST system block carries cache_control, marking the entire
   *      system prefix as cacheable.
   *   4. The LAST tool definition carries cache_control, marking the entire
   *      tool list as cacheable.
   *   5. Per-message cache_control markers are forwarded when set on
   *      ChatMessage (rare, but supports fine-grained breakpoints).
   *   6. JSON.parse on tool arguments is wrapped in try/catch — interrupted
   *      streams can leave a half-parsed JSON string that previously
   *      crashed the entire buildRequest.
   *
   * v3.0.18 change (mid-stream system inlining):
   *   Only the FIRST system message becomes the top-level `system` field
   *   (still a block array, cache_control breakpoint on the last/only block
   *   — unchanged). Every LATER system message — e.g. `[TOOL_REPAIR]` notes
   *   that the agent loop APPENDS each round — is inlined at its original
   *   position as a `role: 'user'` turn with a `[system note] ` text block.
   *   Rationale: appending to the top-level system array changed the tail of
   *   the cacheable prefix every round, so Anthropic re-billed the whole
   *   system + tools as cache_creation_input_tokens every round. Inlining
   *   keeps the top-level prefix byte-stable across the whole session
   *   (same convention as the OpenAI provider's mid-conversation system
   *   downgrade).
   */
  protected buildRequest(messages: ChatMessage[], stream: boolean, options?: ChatOptions, tools?: Tool[]) {
    /** Extract message text whether content is a string or ContentBlock[]. */
    const textOf = (m: ChatMessage): string =>
      typeof m.content === 'string'
        ? m.content
        : m.content.filter(b => b.type === 'text').map(b => (b as any).text).join('');

    // v3.0.3: TTL is sticky per session. The provider's resolvedTtl is
    // set once by LLMService after decideTTL() and never changed within
    // a session (changing it would invalidate the Anthropic cache
    // prefix and cost more in cache_creation_input_tokens than it
    // saves).
    const cacheTtl = this.resolvedTtl;
    const cacheEnabled = this.config.cache?.enabled !== false; // default on for Anthropic

    // 1) FIRST system message only -> top-level `system` block array.
    //    The breakpoint sits on the last (only) block, per Anthropic
    //    convention — the cacheable prefix now ends here and never grows.
    const firstSystem = messages.find(m => m.role === 'system');
    const systemBlocks: any[] | undefined = firstSystem
      ? (() => {
          const block: any = { type: 'text', text: textOf(firstSystem) };
          if (cacheEnabled) {
            block.cache_control = { type: 'ephemeral', ttl: cacheTtl };
          }
          return [block];
        })()
      : undefined;

    // 2) Convert the remaining messages IN ORDER. System messages after the
    //    first are downgraded to user turns tagged with '[system note] ' so
    //    their content still reaches the model at the original position.
    const anthropicMessages: any[] = [];
    let seenFirstSystem = false;
    for (const m of messages) {
      if (m.role === 'system') {
        if (!seenFirstSystem) {
          seenFirstSystem = true;
          continue;
        }
        anthropicMessages.push({
          role: 'user',
          content: [{ type: 'text', text: '[system note] ' + textOf(m) }],
        });
        continue;
      }
      if (m.role === 'tool') {
        // Tool result message
        anthropicMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: m.tool_call_id,
            content: m.content,
          }],
        });
        continue;
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        // Assistant message with tool calls
        const blocks: any[] = [];
        if (m.content) {
          blocks.push({ type: 'text', text: m.content });
        }
        for (const tc of m.tool_calls) {
          // Robust parse: aborted streams can leave a half-formed JSON
          // string. Fall back to {} so the request still goes through and
          // the model can re-request with corrected args.
          let parsedArgs: unknown = {};
          try { parsedArgs = JSON.parse(tc.function.arguments || '{}'); } catch { parsedArgs = {}; }
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: parsedArgs,
          });
        }
        anthropicMessages.push({ role: 'assistant', content: blocks });
        continue;
      }
      // Forward per-message cache_control if the caller attached one.
      // v3.0.5: cache_control is only legal on CONTENT BLOCKS, not on the
      // message object — the previous code attached it at the top level,
      // which the API rejects with 400. Convert string content to a block.
      if (m.cache_control) {
        anthropicMessages.push({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: [{ type: 'text', text: textOf(m), cache_control: m.cache_control }],
        });
        continue;
      }
      anthropicMessages.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      });
    }

    const body: any = {
      model: this.config.model,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature: options?.temperature ?? this.config.temperature,
      ...(systemBlocks ? { system: systemBlocks } : {}),
      messages: anthropicMessages,
      stream,
    };

    // 3) Tools. Attach cache_control only to the LAST tool so Anthropic
    //    caches the entire tool list as a single breakpoint.
    if (tools && tools.length > 0) {
      const toolDefs = this.buildTools(tools);
      if (cacheEnabled) {
        toolDefs[toolDefs.length - 1].cache_control = { type: 'ephemeral', ttl: cacheTtl };
      }
      body.tools = toolDefs;
    }

    return body;
  }

  /**
   * Execute the HTTP request.
   *
   * v3.0.0: serialization via stableStringify; also send the
   * `anthropic-beta: prompt-caching-2024-07-31` header so the API returns
   * cache_read_input_tokens / cache_creation_input_tokens in the streaming
   * usage fields. Some relay stations do not forward this header — that is
   * fine, the rest of the provider still works (just without cache stats).
   *
   * v3.0.18: when the resolved TTL is '1h', opt into the extended cache TTL
   * beta ('extended-cache-ttl-2025-04-11') — without it the API clamps every
   * cache_control ttl:'1h' breakpoint back down to 5 minutes and long
   * sessions silently lose their cache after the first few minutes.
   */
  protected async doRequest(body: any, external?: AbortSignal): Promise<Response> {
    const url = `${this.config.baseUrl}/messages`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s connect
    const signal = external ? AbortSignal.any([controller.signal, external]) : controller.signal;
    const betaHeader = this.resolvedTtl === '1h'
      ? 'prompt-caching-2024-07-31,extended-cache-ttl-2025-04-11'
      : 'prompt-caching-2024-07-31';

    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': betaHeader,
        },
        body: stableStringify(body),
        signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Map Anthropic usage JSON to the canonical Usage shape. Anthropic reports
   * input_tokens / output_tokens on the message_start event, and adds
   * cache_creation_input_tokens / cache_read_input_tokens on message_delta.
   * Either can arrive first depending on the streaming order, so we accept
   * either and merge.
   */
  protected normalizeUsage(raw: any): Usage {
    return {
      prompt_tokens: raw.input_tokens || 0,
      completion_tokens: raw.output_tokens || 0,
      total_tokens: (raw.input_tokens || 0) + (raw.output_tokens || 0),
      cache_creation_input_tokens: raw.cache_creation_input_tokens,
      cache_read_input_tokens: raw.cache_read_input_tokens,
    };
  }
}

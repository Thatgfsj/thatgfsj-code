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
 *     the first (`find` + `system` string) — that bug is fixed here: we
 *     forward every system message and let the provider concatenate.
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

  constructor(config: ProviderConfig) {
    this.config = config;
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
    const response = await this.doRequest(body);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Anthropic API error ${response.status}: ${text}`);
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
    const response = await this.doRequest(body);

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(`Anthropic API error ${response.status}: ${text}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';
    // Track tool use blocks
    const toolUseBlocks: Map<number, { id: string; name: string; input: string }> = new Map();
    let currentBlockIndex = -1;
    let currentBlockType = '';
    // Anthropic attaches usage info to the trailing message_delta event.
    let capturedUsage: Usage | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));

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
            // Per Anthropic docs: usage is only attached on the message_delta
            // event of the LAST chunk (after message_stop), unless the
            // `anthropic-beta: prompt-caching-2024-07-31` header is sent.
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
      reader.releaseLock();
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
   */
  protected buildRequest(messages: ChatMessage[], stream: boolean, options?: ChatOptions, tools?: Tool[]) {
    // 1) Collect ALL system messages, in order, as content blocks. The
    //    final block (and only the final block, per Anthropic convention)
    //    carries the cache_control marker.
    const systemMessages = messages.filter(m => m.role === 'system');
    const cacheTtl = (this.config.cache?.ttl) || DEFAULT_CACHE_TTL;
    const cacheEnabled = this.config.cache?.enabled !== false; // default on for Anthropic

    const systemBlocks = systemMessages.length === 0 ? undefined : systemMessages.map((m, i, arr) => {
      const isLast = i === arr.length - 1;
      // ChatMessage.content may be string | ContentBlock[] (the latter used
      // for multimodal user messages). System messages are always plain
      // strings in our codebase, but be defensive and handle both shapes.
      const text = typeof m.content === 'string'
        ? m.content
        : m.content
            .filter(b => b.type === 'text')
            .map(b => (b as any).text)
            .join('');
      const block: any = { type: 'text', text };
      if (isLast && cacheEnabled) {
        block.cache_control = { type: 'ephemeral', ttl: cacheTtl };
      }
      return block;
    });

    // 2) Convert non-system messages to Anthropic wire format.
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');
    const anthropicMessages = nonSystemMsgs.map(m => {
      if (m.role === 'tool') {
        // Tool result message
        return {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: m.tool_call_id,
            content: m.content,
          }],
        };
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
        return { role: 'assistant', content: blocks };
      }
      // Forward per-message cache_control if the caller attached one
      // (e.g. an inline breakpoint for a particular user message).
      const baseContent = typeof m.content === 'string' ? m.content : m.content;
      const msg: any = {
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: baseContent,
      };
      if (m.cache_control) {
        msg.cache_control = m.cache_control;
      }
      return msg;
    });

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
   */
  protected async doRequest(body: any): Promise<Response> {
    const url = `${this.config.baseUrl}/messages`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s

    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: stableStringify(body),
        signal: controller.signal,
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

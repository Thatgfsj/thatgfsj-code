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
    const response = await this.doRequest(body);
    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content || '',
      role: 'assistant',
      usage: data.usage ? this.normalizeUsage(data.usage) : undefined,
      tool_calls: choice?.message?.tool_calls,
    };
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions, tools?: Tool[]): AsyncGenerator<StreamChunk, ChatResponse> {
    const body = this.buildRequest(messages, true, options, tools);
    const response = await this.doRequest(body);

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(`API error ${response.status}: ${text}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';
    // Accumulate streaming tool call chunks
    const toolCallBuffers: Map<number, { id: string; name: string; arguments: string }> = new Map();
    // Some providers attach usage only on the last chunk (DeepSeek / OpenAI with
    // stream_options.include_usage). We capture it here and yield at the end.
    let capturedUsage: ChatResponse['usage'] | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
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
      reader.releaseLock();
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
    const body: any = {
      model: this.config.model,
      messages: messages.map(m => ({
        role: m.role,
        // content is string | ContentBlock[]. OpenAI wire format accepts both:
        // - string for plain text messages
        // - array of {type,text} or {type,image_url} blocks for multimodal
        content: m.content,
        ...(m.name && { name: m.name }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
        ...(m.cache_control && { cache_control: m.cache_control }),
      })),
      temperature: options?.temperature ?? this.config.temperature,
      max_tokens: options?.maxTokens ?? this.config.maxTokens,
      stream,
      ...(stream && { stream_options: { include_usage: true } }),
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
   */
  protected async doRequest(body: any): Promise<Response> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: stableStringify(body),
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
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
    };
  }
}

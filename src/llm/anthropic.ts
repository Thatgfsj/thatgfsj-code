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
 * - System message is separate (top-level "system" field)
 * - No "system" role in messages array
 * - Tool use blocks have type "tool_use" with "input" (not "arguments")
 * - Tool results use role "tool_result" (not "tool")
 */

import type { ChatMessage, ChatResponse, ChatOptions, ToolCall } from '../types.js';
import type { Tool } from '../tools/types.js';
import type { LLMProvider, StreamChunk, ProviderConfig } from './provider.js';

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
      usage: data.usage ? {
        prompt_tokens: data.usage.input_tokens || 0,
        completion_tokens: data.usage.output_tokens || 0,
        total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
      } : undefined,
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
              }
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

    return { content: fullContent, role: 'assistant', tool_calls: toolCalls.length > 0 ? toolCalls : undefined };
  }

  /**
   * Build request body for Anthropic API
   */
  protected buildRequest(messages: ChatMessage[], stream: boolean, options?: ChatOptions, tools?: Tool[]) {
    // Anthropic uses separate system message
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');

    // Convert messages to Anthropic format
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
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          });
        }
        return { role: 'assistant', content: blocks };
      }
      return {
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      };
    });

    const body: any = {
      model: this.config.model,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature: options?.temperature ?? this.config.temperature,
      ...(systemMsg && { system: systemMsg.content }),
      messages: anthropicMessages,
      stream,
    };

    if (tools && tools.length > 0) {
      body.tools = this.buildTools(tools);
    }

    return body;
  }

  /**
   * Execute the HTTP request
   */
  protected async doRequest(body: any): Promise<Response> {
    const url = `${this.config.baseUrl}/messages`;
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
  }
}

/**
 * OpenAI-compatible Provider
 * Works with: OpenAI, SiliconFlow, DeepSeek, Kimi, Zhipu, MiniMax, Baichuan, Stepfun, Doubao, Ollama, ERNIE
 * Also works with any OpenAI-compatible relay station (中转站)
 */

import type { ChatMessage, ChatResponse, ChatOptions, ToolCall } from '../types.js';
import type { Tool } from '../tools/types.js';
import type { LLMProvider, ProviderConfig } from './provider.js';

export interface StreamChunk {
  type: 'text' | 'tool_calls';
  content?: string;
  toolCalls?: ToolCall[];
}

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
      usage: data.usage ? {
        prompt_tokens: data.usage.prompt_tokens || 0,
        completion_tokens: data.usage.completion_tokens || 0,
        total_tokens: data.usage.total_tokens || 0,
      } : undefined,
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

    return {
      content: fullContent,
      role: 'assistant',
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  /**
   * Build the request body for OpenAI-compatible API
   */
  protected buildRequest(messages: ChatMessage[], stream: boolean, options?: ChatOptions, tools?: Tool[]) {
    const body: any = {
      model: this.config.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.name && { name: m.name }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
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
   * Execute the HTTP request
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
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

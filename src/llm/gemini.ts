/**
 * Google Gemini Provider
 */

import type { ChatMessage, ChatResponse, ChatOptions, ToolCall } from '../types.js';
import type { Tool } from '../tools/types.js';
import type { LLMProvider, StreamChunk, ProviderConfig } from './provider.js';

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  buildTools(tools: Tool[]): any[] {
    return [{
      functionDeclarations: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema || {
          type: 'object',
          properties: Object.fromEntries(
            tool.parameters.map(p => [p.name, { type: p.type, description: p.description }])
          ),
          required: tool.parameters.filter(p => p.required).map(p => p.name),
        },
      })),
    }];
  }

  async chat(messages: ChatMessage[], options?: ChatOptions, tools?: Tool[]): Promise<ChatResponse> {
    const body = this.buildRequest(messages, options, tools);
    const url = `${this.config.baseUrl}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Gemini API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.map((p: any) => p.text).filter(Boolean).join('');

    const functionCalls = parts.filter((p: any) => p.functionCall).map((p: any) => ({
      id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'function' as const,
      function: {
        name: p.functionCall.name,
        arguments: JSON.stringify(p.functionCall.args || {}),
      },
    }));

    return {
      content: text,
      role: 'assistant',
      usage: data.usageMetadata ? {
        prompt_tokens: data.usageMetadata.promptTokenCount || 0,
        completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata.totalTokenCount || 0,
      } : undefined,
      tool_calls: functionCalls.length > 0 ? functionCalls : undefined,
    };
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions, tools?: Tool[]): AsyncGenerator<StreamChunk, ChatResponse> {
    const body = this.buildRequest(messages, options, tools);
    const url = `${this.config.baseUrl}/models/${this.config.model}:streamGenerateContent?alt=sse&key=${this.config.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(`Gemini API error ${response.status}: ${text}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';
    const functionCalls: ToolCall[] = [];

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
            const parts = data.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
              if (part.text) {
                fullContent += part.text;
                yield { type: 'text', content: part.text };
              }
              if (part.functionCall) {
                functionCalls.push({
                  id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  type: 'function',
                  function: {
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args || {}),
                  },
                });
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

    if (functionCalls.length > 0) {
      yield { type: 'tool_calls', toolCalls: functionCalls };
    }

    return { content: fullContent, role: 'assistant', tool_calls: functionCalls.length > 0 ? functionCalls : undefined };
  }

  private buildRequest(messages: ChatMessage[], options?: ChatOptions, tools?: Tool[]) {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');

    const contents = nonSystemMsgs.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body: any = {
      contents,
      ...(systemMsg && {
        systemInstruction: { parts: [{ text: systemMsg.content }] },
      }),
      generationConfig: {
        temperature: options?.temperature ?? this.config.temperature,
        maxOutputTokens: options?.maxTokens ?? this.config.maxTokens,
      },
    };

    if (tools && tools.length > 0) {
      body.tools = this.buildTools(tools);
    }

    return body;
  }
}

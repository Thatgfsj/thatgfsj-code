/**
 * LLM Service - Factory for creating providers
 * Supports all providers + custom relay stations (中转站)
 */

import chalk from 'chalk';
import type { ChatMessage, ChatResponse, ChatOptions, ToolCall } from '../types.js';
import type { Tool } from '../tools/types.js';
import type { LLMProvider, StreamChunk } from './provider.js';
import type { AIConfig, ProviderName } from '../config/types.js';
import { PROVIDERS } from '../config/providers.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';

export class LLMService {
  private provider: LLMProvider;
  private tools: Map<string, Tool> = new Map();
  private apiKey: string;

  constructor(provider: LLMProvider, apiKey: string) {
    this.provider = provider;
    this.apiKey = apiKey;
  }

  static fromConfig(config: AIConfig): LLMService {
    const providerName = config.provider || 'siliconflow';
    const providerConfig = PROVIDERS[providerName];

    const providerCfg = {
      apiKey: config.apiKey || '',
      model: config.model || providerConfig.defaultModel,
      baseUrl: config.baseUrl || providerConfig.baseUrl,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 4096,
    };

    const format = providerConfig.format;
    let provider: LLMProvider;

    switch (format) {
      case 'anthropic':
        provider = new AnthropicProvider(providerCfg);
        break;
      case 'gemini':
        provider = new GeminiProvider(providerCfg);
        break;
      default:
        provider = new OpenAIProvider(providerCfg);
    }

    return new LLMService(provider, providerCfg.apiKey);
  }

  registerTools(tools: Tool[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  getProviderName(): string { return this.provider.name; }
  hasApiKey(): boolean { return !!this.apiKey; }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    if (!this.hasApiKey()) throw new Error(this.getNoKeyMessage());
    const toolsArray = [...this.tools.values()];
    return this.provider.chat(messages, options, toolsArray.length > 0 ? toolsArray : undefined);
  }

  /**
   * Streaming chat with agent loop (tool call support)
   * - Streams text to the user
   * - Detects structured tool calls from the API
   * - Executes tools and loops back for more
   */
  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions & { maxIterations?: number }
  ): AsyncGenerator<string, ChatResponse> {
    if (!this.hasApiKey()) throw new Error(this.getNoKeyMessage());

    const maxIterations = options?.maxIterations ?? 10;
    let currentMessages = [...messages];
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;
      const toolsArray = [...this.tools.values()];
      const hasTools = toolsArray.length > 0;

      let fullContent = '';
      let detectedToolCalls: ToolCall[] | undefined;

      const stream = this.provider.chatStream(currentMessages, options, hasTools ? toolsArray : undefined);

      for await (const chunk of stream) {
        if (chunk.type === 'text' && chunk.content) {
          fullContent += chunk.content;
          yield chunk.content;
        } else if (chunk.type === 'tool_calls' && chunk.toolCalls) {
          detectedToolCalls = chunk.toolCalls;
        }
      }

      // If we got tool calls, execute them and loop
      if (detectedToolCalls && detectedToolCalls.length > 0) {
        // Add assistant message with tool calls
        currentMessages.push({
          role: 'assistant',
          content: fullContent || '',
          tool_calls: detectedToolCalls,
        });

        // Execute each tool
        for (const toolCall of detectedToolCalls) {
          const tool = this.tools.get(toolCall.function.name);

          // Yield structured tool call as JSON line
          yield `\n@@TOOL@@${JSON.stringify({ action: 'call', name: toolCall.function.name, args: toolCall.function.arguments })}\n`;

          if (!tool) {
            const errMsg = `Tool "${toolCall.function.name}" not found`;
            currentMessages.push({
              role: 'tool',
              content: errMsg,
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            });
            yield `@@TOOL@@${JSON.stringify({ action: 'result', error: errMsg })}\n`;
            continue;
          }

          try {
            const params = JSON.parse(toolCall.function.arguments || '{}');
            const result = await tool.execute(params);
            const output = result.success ? (result.output || JSON.stringify(result.data)) : (result.error || 'Tool failed');

            currentMessages.push({
              role: 'tool',
              content: output,
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            });

            yield `@@TOOL@@${JSON.stringify({ action: 'result', output })}\n`;
          } catch (error: any) {
            const errMsg = `Error: ${error.message}`;
            currentMessages.push({
              role: 'tool',
              content: errMsg,
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            });
            yield `@@TOOL@@${JSON.stringify({ action: 'result', error: errMsg })}\n`;
          }
        }

        yield '\n';
        continue;
      }

      // No tool calls - done
      return { content: fullContent, role: 'assistant' };
    }

    return { content: '[Agent loop exceeded maximum iterations]', role: 'assistant' };
  }

  private truncateArgs(args: string): string {
    try {
      const obj = JSON.parse(args || '{}');
      const entries = Object.entries(obj);
      if (entries.length === 0) return '';
      return entries.map(([k, v]) => {
        const val = typeof v === 'string' && v.length > 50 ? v.slice(0, 50) + '...' : v;
        return `${k}: ${JSON.stringify(val)}`;
      }).join(', ');
    } catch {
      return args.length > 80 ? args.slice(0, 80) + '...' : args;
    }
  }

  private getNoKeyMessage(): string {
    return [
      '❌ 未配置 API Key，无法调用 AI。',
      '',
      '请先运行: gfcode init',
      '',
      '或设置环境变量:',
      '  export SILICONFLOW_API_KEY="sk-..."',
      '  export OPENAI_API_KEY="sk-..."',
      '  export DEEPSEEK_API_KEY="sk-..."',
    ].join('\n');
  }
}

export type { LLMProvider, ProviderConfig, StreamChunk } from './provider.js';
export { OpenAIProvider } from './openai.js';
export { AnthropicProvider } from './anthropic.js';
export { GeminiProvider } from './gemini.js';

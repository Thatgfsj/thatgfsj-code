/**
 * AI Engine - Core AI interaction module
 * Supports multiple providers: MiniMax, SiliconFlow, OpenAI, Anthropic
 * 
 * Implements S01: Agent Loop pattern with async generator for streaming
 * Core pattern: while(true) { response → execute tools → append results → repeat }
 */

import chalk from 'chalk';
import { ChatMessage, AIResponse, AIConfig, Tool, ToolCall } from './types.js';

export { AIResponse, ChatMessage };

export class AIEngine {
  private config: AIConfig;
  private tools: Map<string, Tool> = new Map();

  constructor(config: AIConfig) {
    this.config = config;
  }

  /**
   * Register tools for function calling
   */
  registerTool(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string) {
    this.tools.delete(name);
  }

  /**
   * Get registered tools for API
   */
  private getToolsForAPI() {
    return Array.from(this.tools.values()).map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.parameters.reduce((acc, p) => {
            acc[p.name] = { type: p.type, description: p.description };
            return acc;
          }, {} as any),
          required: tool.parameters.filter(p => p.required).map(p => p.name)
        }
      }
    }));
  }

  // ==================== S01: Async Generator Agent Loop ====================
  // Pattern from Claude Code: async function* that yields streaming chunks
  // while(true) { response → tools → append → repeat }

  /**
   * S01 Core: Async Generator Agent Loop
   * Yields streaming text chunks, handles tool calls automatically
   * This is the main entry point for streaming agent behavior
   */
  async *chatStream(
    messages: ChatMessage[],
    maxIterations: number = 10
  ): AsyncGenerator<string, AIResponse, unknown> {
    let currentMessages = [...messages];
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;

      // Yield streaming chunks from LLM call
      let fullResponse = '';
      let hasToolCalls = false;

      for await (const chunk of this.streamRequest(currentMessages)) {
        fullResponse += chunk;
        yield chunk; // Stream each chunk to caller
      }

      // Parse response for tool calls
      const response = this.parseResponse(fullResponse);

      if (response.tool_calls && response.tool_calls.length > 0) {
        hasToolCalls = true;

        // Add assistant message to history
        currentMessages.push({
          role: 'assistant',
          content: response.content,
          tool_calls: response.tool_calls
        });

        // Execute each tool
        for (const toolCall of response.tool_calls) {
          const result = await this.executeToolCall(toolCall);

          // Yield tool result as special output
          const toolResultMsg: ChatMessage = {
            role: 'tool',
            content: result.output || result.error || '',
            tool_call_id: toolCall.id,
            name: toolCall.function.name
          };
          currentMessages.push(toolResultMsg);

          // Yield tool execution feedback
          yield `\n${chalk.gray(`[tool: ${toolCall.function.name}]`)}`;
        }

        // Continue loop — back to LLM with tool results
        continue;
      }

      // No tool calls — exit loop, return final response
      if (response.content) {
        currentMessages.push({
          role: 'assistant',
          content: response.content
        });
      }

      return response;
    }

    // Max iterations reached
    return {
      content: '[Agent loop exceeded maximum iterations]',
      role: 'assistant'
    };
  }

  /**
   * S01 Core: Stream request — yields chunks as they arrive
   * Uses async generator for backpressure control and lazy evaluation
   */
  private async *streamRequest(
    messages: ChatMessage[]
  ): AsyncGenerator<string, void, unknown> {
    const apiKey = this.config.apiKey || this.getApiKey();

    if (!apiKey) {
      // Mock streaming for demo
      const mock = this.getMockResponse(messages);
      for (const char of mock) {
        await new Promise(r => setTimeout(r, 10));
        yield char;
      }
      return;
    }

    const isAnthropicFormat = this.config.provider === 'anthropic' || this.config.provider === 'minimax';
    const isGeminiFormat = this.config.provider === 'gemini';

    let url: string;
    let headers: Record<string, string> = {};
    let body: any;

    if (isGeminiFormat) {
      url = `${this.config.baseUrl}/models/${this.config.model}:generateContent`;
      headers = { 'Content-Type': 'application/json' };
      body = this.buildGeminiRequest(messages);
    } else if (isAnthropicFormat) {
      url = `${this.config.baseUrl}/messages-stream`;
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      };
      body = this.buildAnthropicRequest(messages, true);
    } else {
      url = `${this.config.baseUrl}/chat/completions`;
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };
      body = this.buildOpenAIRequest(messages, true);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok || !response.body) {
      yield `\n${chalk.red(`[API Error: ${response.status}]`)}`;
      return;
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const text = this.extractChunkText(chunk, isAnthropicFormat, isGeminiFormat);
        if (text) {
          yield text;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Extract text from streaming chunk based on provider format
   */
  private extractChunkText(
    chunk: string,
    isAnthropic: boolean,
    isGemini: boolean
  ): string {
    if (isAnthropic) {
      // Anthropic streaming format: data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}
      const match = chunk.match(/"type"\s*:\s*"text_delta"\s*,\s*"text"\s*:\s*"([^"]*)"/);
      return match ? match[1] : '';
    } else if (isGemini) {
      // Gemini format
      const match = chunk.match(/"text"\s*:\s*"([^"]*)"/);
      return match ? match[1] : '';
    } else {
      // OpenAI SSE format: data: {"choices":[{"delta":{"content":"..."}}]}
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            const content = data.choices?.[0]?.delta?.content;
            if (content) return content;
          } catch {
            // Skip invalid JSON
          }
        }
      }
      return '';
    }
  }

  /**
   * Parse full response text into structured AIResponse
   */
  private parseResponse(fullText: string): AIResponse {
    // For now return content as-is; tool call parsing happens via content patterns
    return {
      content: fullText,
      role: 'assistant',
      tool_calls: this.extractToolCalls(fullText)
    };
  }

  /**
   * Extract tool calls from response content
   */
  private extractToolCalls(content: string): ToolCall[] | undefined {
    // Simple pattern: look for tool_call blocks in response
    // In real implementation this would be parsed from structured response
    // For streaming, we check if content indicates a tool call
    if (!content.includes('tool_use')) return undefined;
    return undefined; // Placeholder — actual implementation depends on provider
  }

  // ==================== Legacy chat() — delegates to chatStream ====================

  /**
   * Original non-streaming chat — now implemented via chatStream
   */
  async chat(messages: ChatMessage[], maxIterations: number = 5): Promise<AIResponse> {
    let fullContent = '';

    for await (const chunk of this.chatStream(messages, maxIterations)) {
      fullContent += chunk;
    }

    return {
      content: fullContent,
      role: 'assistant'
    };
  }

  // ==================== Tool Execution ====================

  private async executeToolCall(toolCall: ToolCall): Promise<{ output?: string; error?: string }> {
    const { name, arguments: args } = toolCall.function;
    const tool = this.tools.get(name);

    if (!tool) {
      return { error: `Tool "${name}" not found` };
    }

    try {
      const params = JSON.parse(args);
      const result = await tool.execute(params, {
        confirmAction: async (msg: string): Promise<boolean> => {
          console.log(chalk.yellow(`\n⚠️  Tool wants to execute: ${msg}`));
          return false; // Default deny in CLI mode
        }
      });

      return {
        output: result.success ? (result.output || JSON.stringify(result.data)) : undefined,
        error: result.error
      };
    } catch (error: any) {
      return { error: `Tool execution failed: ${error.message}` };
    }
  }

  // ==================== Request Builders ====================

  private buildOpenAIRequest(messages: ChatMessage[], stream: boolean) {
    const tools = this.getToolsForAPI();
    return {
      model: this.config.model || 'Qwen/Qwen2.5-7B-Instruct',
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        name: m.name,
        tool_call_id: m.tool_call_id,
        tool_calls: m.tool_calls
      })),
      temperature: this.config.temperature || 0.7,
      max_tokens: this.config.maxTokens || 4096,
      stream,
      ...(tools.length > 0 && { tools })
    };
  }

  private buildAnthropicRequest(messages: ChatMessage[], stream: boolean) {
    const anthropicMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }));

    return {
      model: this.config.model || 'claude-3-haiku-20240307',
      messages: anthropicMessages,
      max_tokens: this.config.maxTokens || 4096,
      temperature: this.config.temperature || 0.7,
      stream
    };
  }

  private buildGeminiRequest(messages: ChatMessage[]) {
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

    return {
      contents,
      generationConfig: {
        temperature: this.config.temperature || 0.7,
        maxOutputTokens: this.config.maxTokens || 4096
      }
    };
  }

  private getApiKey(): string {
    const provider = this.config.provider || 'siliconflow';

    const envKeys: Record<string, string[]> = {
      siliconflow: ['SILICONFLOW_API_KEY', 'OPENAI_API_KEY'],
      minimax: ['MINIMAX_API_KEY', 'OPENAI_API_KEY'],
      openai: ['OPENAI_API_KEY'],
      anthropic: ['ANTHROPIC_API_KEY'],
      ollama: [],
      gemini: ['GEMINI_API_KEY'],
      kimi: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
      deepseek: ['DEEPSEEK_API_KEY']
    };

    for (const key of envKeys[provider] || []) {
      if (process.env[key]) return process.env[key];
    }

    return '';
  }

  private getMockResponse(messages: ChatMessage[]): string {
    const lastMessage = messages[messages.length - 1]?.content || '';
    let response = 'Hello! I am Thatgfsj Code.\n\n';

    if (lastMessage.toLowerCase().includes('hello') || lastMessage.toLowerCase().includes('hi')) {
      response = 'Hi there! How can I help you today?';
    } else if (lastMessage.toLowerCase().includes('who are you')) {
      response = 'I am Thatgfsj Code, an AI assistant built with Node.js.';
    } else {
      response = `I understand you said: "${lastMessage.slice(0, 50)}..."\n\nThis is a streaming demo. Enable an API key for full AI capabilities.`;
    }

    return response;
  }
}

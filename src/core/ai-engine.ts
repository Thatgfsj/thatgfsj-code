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

/**
 * Best-effort JSON.parse that returns {} on failure. Used when extracting
 * tool-call `arguments` from a streamed response, where partial JSON
 * strings may fail to parse until the model finishes emitting.
 */
function safeParseArgs(raw: string | undefined): Record<string, any> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/**
 * Internal accumulator that lives for the duration of one streamed
 * response. It captures both text deltas (which we yield to the caller)
 * AND tool-call deltas (which we aggregate into a complete ToolCall[]).
 *
 * Previously (v2.2.0) the SSE parser only extracted `delta.content` and
 * threw away every `delta.tool_calls` chunk, so the agent loop's
 * "if (response.tool_calls...)" branch was unreachable. v2.2.1 wires
 * this back together by accumulating tool calls across multiple chunks
 * the same way OpenAI does server-side.
 *
 * v2.2.1 supports the OpenAI-compatible streaming protocol fully
 * (covers OpenAI / SiliconFlow / MiniMax / Kimi / DeepSeek / Ollama /
 *  any other OpenAI-shape backend). Anthropic and Gemini providers
 *  still send `tools` in the request body, but the SSE parser for
 *  their tool-call streaming chunks is left as a TODO — the model will
 *  fall back to text-only responses on those providers until 2.2.2.
 */
class StreamAccumulator {
  /** Complete text accumulated so far (also kept so we can echo it back). */
  fullText: string = '';
  /** Tool calls keyed by their `index` field (OpenAI shape). */
  private toolCalls: Map<number, ToolCall> = new Map();
  /** Provider-reported finish reason, if any. */
  finishReason: string | null = null;

  /**
   * OpenAI-compatible SSE chunk. Returns the text delta to yield, OR
   * null if this chunk only contained tool-call deltas.
   */
  ingestOpenAI(line: string): string | null {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') return null;
    let payload: any;
    try {
      payload = JSON.parse(line.slice(6));
    } catch {
      return null;
    }
    const choice = payload?.choices?.[0];
    if (!choice) return null;
    if (choice.finish_reason) this.finishReason = choice.finish_reason;

    const delta = choice.delta ?? {};
    let textDelta: string | null = null;
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      textDelta = delta.content;
      this.fullText += textDelta;
    }

    // Accumulate tool_calls: each delta may carry only one field of one call.
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === 'number' ? tc.index : 0;
        let existing = this.toolCalls.get(idx);
        if (!existing) {
          existing = {
            id: tc.id || `call_${idx}`,
            type: 'function',
            function: { name: '', arguments: '' },
          };
          this.toolCalls.set(idx, existing);
        }
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name += tc.function.name;
        if (typeof tc.function?.arguments === 'string') {
          existing.function.arguments += tc.function.arguments;
        }
      }
    }
    return textDelta;
  }

  /**
   * Anthropic SSE chunk. v2.2.1 only extracts text here; tool_use block
   * streaming is the TODO listed in the changelog.
   */
  ingestAnthropic(chunk: string): string | null {
    const match = chunk.match(/"type"\s*:\s*"text_delta"\s*,\s*"text"\s*:\s*"([^"]*)"/);
    if (!match) return null;
    this.fullText += match[1];
    return match[1];
  }

  /**
   * Gemini SSE chunk. v2.2.1 only extracts text here; functionCall
   * streaming is the TODO listed in the changelog.
   */
  ingestGemini(chunk: string): string | null {
    const match = chunk.match(/"text"\s*:\s*"([^"]*)"/);
    if (!match) return null;
    this.fullText += match[1];
    return match[1];
  }

  /** Final tool calls sorted by their original `index`. Empty if none. */
  finalizeToolCalls(): ToolCall[] | undefined {
    if (this.toolCalls.size === 0) return undefined;
    return Array.from(this.toolCalls.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, tc]) => tc);
  }
}

export class AIEngine {
  private config: AIConfig;
  private tools: Map<string, Tool> = new Map();
  /**
   * Optional confirm callback injected by the REPL (or CLI single-shot).
   * If unset, tools that ask for confirmation are auto-approved — the
   * single-shot CLI flow has no way to ask the user mid-stream.
   */
  private confirmAction: ((msg: string) => Promise<boolean>) | null = null;

  constructor(config: AIConfig) {
    this.config = config;
  }

  /**
   * Replace the active configuration at runtime.
   * Used by the REPL `/model` / `/provider` commands — the next streamed
   * request will pick up the new model / baseUrl / provider.
   */
  updateConfig(config: AIConfig): void {
    this.config = config;
  }

  /**
   * Inspect a snapshot of the active configuration (read-only).
   */
  getConfig(): Readonly<AIConfig> {
    return this.config;
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
   * Get registered tools for API (S02: uses ToolRegistry if available)
   */
  private getToolsForAPI() {
    // If registry is injected, use its getToolsForAPI
    if (this.registry) {
      return this.registry.getToolsForAPI();
    }
    // Fallback: build from tools map
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

  // S02: Inject registry for enhanced tool management
  setRegistry(registry: any) {
    this.registry = registry;
  }
  private registry?: any;

  // S08: Hook manager
  setHooks(hooks: import('./hooks.js').HookManager) {
    this.hooks = hooks;
  }
  private hooks?: import('./hooks.js').HookManager | null = null;

  /**
   * v2.2.1: inject the confirmation prompt used when a Tool calls
   * `ctx.confirmAction(msg)`. The REPL passes an @inquirer/confirm-based
   * prompt; the single-shot CLI passes `null` (=> auto-approve) so the
   * non-interactive flow doesn't deadlock.
   */
  setConfirmAction(fn: ((msg: string) => Promise<boolean>) | null) {
    this.confirmAction = fn;
  }

  // ==================== S01: Async Generator Agent Loop ====================

  async *chatStream(
    messages: ChatMessage[],
    maxIterations: number = 10,
    signal?: AbortSignal,
  ): AsyncGenerator<string, AIResponse, unknown> {
    let currentMessages = [...messages];
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;

      // S08 Hook: beforeAgentLoop
      if (this.hooks) {
        await this.hooks.emit('beforeAgentLoop', { messages: currentMessages, iteration: iterations });
      }

      // v2.2.1: collect both text deltas AND tool-call deltas in a single
      // accumulator. streamRequest() now yields text deltas only; the
      // accumulator also tracks tool_calls as it parses them.
      const accumulator = new StreamAccumulator();

      for await (const chunk of this.streamRequest(currentMessages, signal, accumulator)) {
        yield chunk;
        if (signal?.aborted) break;
      }

      const toolCalls = accumulator.finalizeToolCalls();
      const responseContent = accumulator.fullText;

      if (toolCalls && toolCalls.length > 0) {
        currentMessages.push({
          role: 'assistant',
          content: responseContent,
          tool_calls: toolCalls,
        });

        // Execute each tool
        for (const toolCall of toolCalls) {
          // S08 Hook: beforeToolCall
          if (this.hooks) {
            let parsedParams: Record<string, any> = {};
            try { parsedParams = JSON.parse(toolCall.function.arguments || '{}'); } catch {}
            await this.hooks.emit('beforeToolCall', {
              toolName: toolCall.function.name,
              toolParams: parsedParams,
              toolCallId: toolCall.id,
            });
          }

          const result = await this.executeToolCall(toolCall);

          // S08 Hook: afterToolCall
          if (this.hooks) {
            await this.hooks.emit('afterToolCall', {
              toolName: toolCall.function.name,
              toolParams: safeParseArgs(toolCall.function.arguments),
              toolResult: result,
              toolCallId: toolCall.id,
            });
          }

          const toolResultMsg: ChatMessage = {
            role: 'tool',
            content: result.output || result.error || '',
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
          };
          currentMessages.push(toolResultMsg);

          yield `\n${chalk.gray(`[tool: ${toolCall.function.name}] ${result.error ? '✗' : '✓'}`)}`;
        }

        continue;
      }

      // No tool calls — exit loop
      if (responseContent) {
        currentMessages.push({
          role: 'assistant',
          content: responseContent,
        });
      }

      // S08 Hook: afterAgentLoop
      if (this.hooks) {
        await this.hooks.emit('afterAgentLoop', { messages: currentMessages, iteration: iterations });
      }

      return {
        content: responseContent,
        role: 'assistant',
      };
    }

    // Max iterations reached
    return {
      content: '[Agent loop exceeded maximum iterations]',
      role: 'assistant',
    };
  }

  /**
   * S01 Core: Stream request — yields chunks as they arrive
   * Uses async generator for backpressure control and lazy evaluation.
   *
   * v2.2.1: the `accumulator` parameter is mutated as we read the
   * stream — it captures text deltas, tool-call deltas, and finish
   * reasons. We yield only the text delta portion here; the chatStream
   * caller reads `accumulator.finalizeToolCalls()` after the stream
   * completes.
   *
   * Pass `signal` to make the underlying fetch + reader actually abort
   * when Ctrl+C is pressed; without it the network call continues to
   * completion in the background even after the for-await loop breaks.
   */
  private async *streamRequest(
    messages: ChatMessage[],
    signal?: AbortSignal,
    accumulator?: StreamAccumulator,
  ): AsyncGenerator<string, void, unknown> {
    const apiKey = this.config.apiKey || this.getApiKey();

    if (!apiKey) {
      // Mock streaming for demo
      const mock = this.getMockResponse(messages);
      for (const char of mock) {
        if (signal?.aborted) return;
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

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Caller (processInput) detects this and skips persisting the
        // truncated response. Just bail without yielding anything.
        return;
      }
      throw err;
    }

    if (!response.ok || !response.body) {
      yield `\n${chalk.red(`[API Error: ${response.status}]`)}`;
      return;
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    // Reuse caller-provided accumulator or create a fresh one. We need
    // *some* accumulator to feed tool-call deltas into, even though
    // chatStream normally passes its own.
    const acc = accumulator ?? new StreamAccumulator();

    try {
      while (true) {
        if (signal?.aborted) {
          try { await reader.cancel(); } catch {}
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        if (isAnthropicFormat) {
          const text = acc.ingestAnthropic(chunk);
          if (text) yield text;
        } else if (isGeminiFormat) {
          const text = acc.ingestGemini(chunk);
          if (text) yield text;
        } else {
          // OpenAI / OpenAI-compatible SSE — multiple `data:` lines per
          // chunk, each may carry a delta.
          for (const line of chunk.split('\n')) {
            const text = acc.ingestOpenAI(line);
            if (text) yield text;
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
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

    let params: Record<string, any> = {};
    try {
      params = JSON.parse(args);
    } catch {
      return { error: `Tool "${name}" received invalid JSON arguments: ${args}` };
    }

    try {
      const result = await tool.execute(params, {
        confirmAction: this.confirmAction ?? (async () => true),
        signal: this.streamAbortSignal,
      });

      return {
        output: result.success ? (result.output || JSON.stringify(result.data)) : undefined,
        error: result.error,
      };
    } catch (error: any) {
      return { error: `Tool execution failed: ${error.message}` };
    }
  }

  /**
   * v2.2.1: short-lived hook so Tools can react to Ctrl+C during their
   * own execute() call. The REPL sets this before each chatStream call
   * (via setCurrentAbortSignal), tools that support an AbortSignal
   * (e.g. long-running shell commands) can honor it.
   */
  private streamAbortSignal: AbortSignal | undefined;
  setCurrentAbortSignal(signal: AbortSignal | undefined) {
    this.streamAbortSignal = signal;
  }

  // ==================== Request Builders ====================

  private buildOpenAIRequest(messages: ChatMessage[], stream: boolean) {
    const tools = this.getToolsForAPI();
    return {
      model: this.config.model || 'Qwen/Qwen2.5-7B-Instruct',
      messages: messages.map(m => {
        const out: Record<string, any> = {
          role: m.role,
          content: m.content ?? '',
        };
        if (m.name) out.name = m.name;
        if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
        if (m.tool_calls && m.tool_calls.length > 0) out.tool_calls = m.tool_calls;
        return out;
      }),
      temperature: this.config.temperature || 0.7,
      max_tokens: this.config.maxTokens || 4096,
      stream,
      ...(tools.length > 0 && { tools }),
    };
  }

  private buildAnthropicRequest(messages: ChatMessage[], stream: boolean) {
    // Convert our internal ChatMessage[] into Anthropic's wire format.
    //  - 'system'    → top-level `system` field
    //  - 'assistant' with tool_calls → content array with text + tool_use blocks
    //  - 'tool'      → merged into the next 'user' message as a tool_result block
    //                  (Anthropic requires tool_result on user-role turns)
    const systemParts: string[] = [];
    const converted: Array<{ role: 'user' | 'assistant'; content: any }> = [];

    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];

    const flushToolResults = () => {
      if (toolResults.length === 0) return;
      converted.push({ role: 'user', content: toolResults.splice(0) });
    };

    for (const m of messages) {
      if (m.role === 'system') {
        systemParts.push(m.content);
        continue;
      }
      if (m.role === 'tool') {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: m.tool_call_id || '',
          content: m.content || '',
        });
        continue;
      }
      // Flush any pending tool_result blocks before continuing the turn.
      flushToolResults();
      if (m.role === 'assistant') {
        const blocks: any[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        if (m.tool_calls) {
          for (const tc of m.tool_calls) {
            blocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: safeParseArgs(tc.function.arguments),
            });
          }
        }
        converted.push({ role: 'assistant', content: blocks.length > 0 ? blocks : '' });
      } else if (m.role === 'user') {
        converted.push({ role: 'user', content: m.content });
      }
    }
    flushToolResults();

    const tools = this.getToolsForAPI().map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));

    const body: any = {
      model: this.config.model || 'claude-3-haiku-20240307',
      messages: converted,
      max_tokens: this.config.maxTokens || 4096,
      temperature: this.config.temperature || 0.7,
      stream,
    };
    if (systemParts.length > 0) {
      body.system = systemParts.join('\n\n');
    }
    if (tools.length > 0) {
      body.tools = tools;
    }
    return body;
  }

  private buildGeminiRequest(messages: ChatMessage[]) {
    // Convert our internal ChatMessage[] into Gemini's wire format.
    //  - 'system' is dropped (Gemini doesn't have a top-level system
    //    slot; we keep it out of the loop on purpose)
    //  - 'tool'   → 'user' turn with a `functionResponse` part
    //  - assistant tool_calls → 'model' turn with `functionCall` parts
    const contents: any[] = [];

    const pushTurn = (role: 'user' | 'model', parts: any[]) => {
      if (parts.length === 0) return;
      contents.push({ role, parts });
    };

    let userBuf: any[] = [];
    let modelBuf: any[] = [];

    const flushUser = () => {
      if (userBuf.length > 0) { pushTurn('user', userBuf); userBuf = []; }
    };
    const flushModel = () => {
      if (modelBuf.length > 0) { pushTurn('model', modelBuf); modelBuf = []; }
    };

    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'tool') {
        // Gemini requires tool results to live on a user turn.
        flushModel();
        userBuf.push({
          functionResponse: {
            name: m.name || '',
            response: { result: m.content || '' },
          },
        });
        continue;
      }
      if (m.role === 'assistant') {
        flushUser();
        if (m.content) modelBuf.push({ text: m.content });
        if (m.tool_calls) {
          for (const tc of m.tool_calls) {
            modelBuf.push({
              functionCall: {
                name: tc.function.name,
                args: safeParseArgs(tc.function.arguments),
              },
            });
          }
        }
        continue;
      }
      // user
      flushModel();
      if (m.content) userBuf.push({ text: m.content });
    }
    flushModel();
    flushUser();

    const toolsRaw = this.getToolsForAPI().map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));

    const body: any = {
      contents,
      generationConfig: {
        temperature: this.config.temperature || 0.7,
        maxOutputTokens: this.config.maxTokens || 4096,
      },
    };
    if (toolsRaw.length > 0) {
      body.tools = [{ functionDeclarations: toolsRaw }];
    }
    return body;
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

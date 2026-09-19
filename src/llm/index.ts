/**
 * LLM Service - Factory for creating providers
 * Supports all providers + custom relay stations (中转站)
 *
 * v3.0.0+: streaming protocol migrated to structured StreamChunk
 *   - chatStream yields { type: 'text' | 'tool_calls' | 'thinking' | 'usage' }
 *   - Tool call execution is now part of the agent loop; consumers see
 *     { type: 'tool_calls', toolCalls } for dispatch and { type: 'text', content }
 *     for model output. The legacy @@TOOL@@ sentinel-string protocol is GONE.
 *   - Usage / cache stats are emitted as the final { type: 'usage' } chunk,
 *     which the TUI cache stats store consumes.
 */

import chalk from 'chalk';
import type { ChatMessage, ChatResponse, ChatOptions, ToolCall, StreamChunk, ToolCallResult } from '../types.js';
import type { Tool, ToolContext } from '../tools/types.js';
import type { LLMProvider } from './provider.js';
import type { AIConfig, Config, ProviderName } from '../config/types.js';
import { PROVIDERS } from '../config/providers.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { decideTTL } from '../cache/smartModel.js';

export class LLMService {
  private provider: LLMProvider;
  private tools: Map<string, Tool> = new Map();
  private apiKey: string;
  /**
   * v3.0.5: execution context handed to every tool (confirmAction, abort
   * signal, working directory). Previously tools were called with no
   * context at all, which made the whole permission pipeline dead code.
   */
  private toolCtx: ToolContext = {};

  constructor(provider: LLMProvider, apiKey: string) {
    this.provider = provider;
    this.apiKey = apiKey;
  }

  /** v3.0.5: wire the execution context (confirm/signal/cwd) into tool calls. */
  setToolContext(ctx: ToolContext): void {
    this.toolCtx = ctx;
  }

  /**
   * v3.0.3: TTL resolved from config + smart routing. Stays null until
   * the first round, then never changes for the session. Anthropic
   * provider's setResolvedTTL is called at the same time, so the wire
   * prefix is consistent across rounds.
   */
  private resolvedTtl: '5m' | '1h' | null = null;

  /** Public accessor used by App.streamResponse to surface TTL in the UI. */
  getResolvedTTL(): '5m' | '1h' | null {
    return this.resolvedTtl;
  }

  static fromConfig(config: AIConfig & { cache?: Config['cache'] }): LLMService {
    const providerName = config.provider || 'siliconflow';
    const providerConfig = PROVIDERS[providerName];

    const providerCfg = {
      apiKey: config.apiKey || '',
      model: config.model || providerConfig.defaultModel,
      baseUrl: config.baseUrl || providerConfig.baseUrl,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 4096,
      // v3.0.0: forward cache policy. Anthropic reads this to decide
      // whether to attach cache_control markers; other providers ignore it.
      // v3.0.3: ttl accepts '5m' | '1h' | 'auto'. 'auto' is resolved
      // per-session by decideTTL() inside chatStream.
      cache: config.cache ?? { enabled: true, ttl: 'auto' as const, strategy: 'auto' as const },
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

  /** v3.0.5: drop all registered tools (used by reloadModel to re-register cleanly). */
  clearTools(): void {
    this.tools.clear();
  }

  /**
   * v3.0.5: pin the Anthropic cache TTL immediately (from /ttl). Changing
   * TTL mid-session invalidates the upstream cache prefix once — the user
   * explicitly asked for it, so that cost is accepted.
   */
  setTtl(ttl: '5m' | '1h'): void {
    this.resolvedTtl = ttl;
    if (typeof (this.provider as any).setResolvedTTL === 'function') {
      (this.provider as any).setResolvedTTL(ttl);
    }
  }

  /** v3.0.5: reset TTL resolution (used when the model/service is rebuilt). */
  resetTtl(): void {
    this.resolvedTtl = null;
  }

  getProviderName(): string { return this.provider.name; }
  hasApiKey(): boolean { return !!this.apiKey; }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    if (!this.hasApiKey()) throw new Error(this.getNoKeyMessage());
    const toolsArray = [...this.tools.values()];
    return this.provider.chat(messages, options, toolsArray.length > 0 ? toolsArray : undefined);
  }

  /**
   * Streaming chat with agent loop (tool call support).
   *
   * Structured chunk protocol (replaces the @@TOOL@@ sentinel strings):
   *   { type: 'text',       content: string }      model output, accumulate + render
   *   { type: 'tool_calls', toolCalls: ToolCall[] } dispatch tools, results will
   *                                                be folded into the next request
   *   { type: 'thinking',   content: string }      reasoning text (consumers may
   *                                                display in debug mode)
   *   { type: 'usage',      usage: Usage }         cache hit/miss + token counts;
   *                                                emitted on the final round
   *
   * Returns the final ChatResponse of the agent loop when done.
   */
  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions & { maxIterations?: number; signal?: AbortSignal }
  ): AsyncGenerator<StreamChunk, ChatResponse> {
    if (!this.hasApiKey()) throw new Error(this.getNoKeyMessage());

    // v3.0.3: Resolve TTL once per session.
    // v3.0.4: default is 1h (long-task). 'auto' (legacy config value)
    // resolves via decideTTL which now always returns 1h — we cannot
    // predict task length at round 0, so we default to the TTL that
    // cannot expire mid-task. '5m'/'1h' are explicit user pins.
    const configTtl = (this.provider as any).config?.cache?.ttl;
    if (configTtl === 'auto' && this.resolvedTtl === null) {
      const decision = decideTTL(messages, null);
      this.resolvedTtl = decision.ttl;
      if (typeof (this.provider as any).setResolvedTTL === 'function') {
        (this.provider as any).setResolvedTTL(decision.ttl);
      }
    } else if (configTtl === '5m' || configTtl === '1h') {
      // User pinned a specific TTL — apply it once and keep it.
      if (this.resolvedTtl === null) {
        this.resolvedTtl = configTtl;
        if (typeof (this.provider as any).setResolvedTTL === 'function') {
          (this.provider as any).setResolvedTTL(configTtl);
        }
      }
    }

    const maxIterations = options?.maxIterations ?? 10;
    let currentMessages = [...messages];
    let iterations = 0;
    let lastUsage: ChatResponse['usage'] | undefined;

    while (iterations < maxIterations) {
      iterations++;
      const toolsArray = [...this.tools.values()];
      const hasTools = toolsArray.length > 0;

      let fullContent = '';
      let detectedToolCalls: ToolCall[] | undefined;

      // Forward stream chunks from the provider. We collect text internally for
      // tool-call persistence but always re-emit the original chunks unchanged.
      const stream = this.provider.chatStream(currentMessages, options, hasTools ? toolsArray : undefined);

      for await (const chunk of stream) {
        if (chunk.type === 'text' && chunk.content) {
          fullContent += chunk.content;
          yield chunk;
        } else if (chunk.type === 'tool_calls' && chunk.toolCalls) {
          detectedToolCalls = chunk.toolCalls;
          // Don't yield the raw tool_calls chunk here — we emit one combined
          // chunk after persisting the assistant message so consumers don't
          // double-render.
        } else if (chunk.type === 'thinking') {
          yield chunk;
        } else if (chunk.type === 'usage') {
          lastUsage = chunk.usage;
          yield chunk;
        }
      }

      // If we got tool calls, execute them and loop
      if (detectedToolCalls && detectedToolCalls.length > 0) {
        // Add assistant message with tool calls (append-only, preserves prefix cache)
        currentMessages.push({
          role: 'assistant',
          content: fullContent || '',
          tool_calls: detectedToolCalls,
        });

        // Execute each tool and emit a single structured tool_calls chunk
        // describing the dispatch plan. Per-tool results are appended to
        // currentMessages but NOT yielded as additional chunks — consumers
        // that want to display result text can introspect tool_calls[*].result
        // on a synthesized combined chunk, OR we re-emit one tool_calls chunk
        // at the end with results attached. We choose the simpler approach:
        // emit ONE tool_calls chunk per iteration with all the calls; results
        // are surfaced through the next assistant turn's text content.
        //
        // v3.0.0 Tool-call Repair (Reasonix P2): on tool failure we APPEND
        // a `[TOOL_REPAIR]` system message rather than mutating the existing
        // tool_call message. This preserves the upstream cache prefix —
        // re-writing an earlier message would shift the prefix by N bytes
        // and bust the cache for every subsequent round.
        // v3.0.5: execute tools with the shared ToolContext (confirm/signal/cwd)
        // and collect index-aligned results so consumers (TUI, headless --json)
        // can render per-tool outcomes.
        const callResults: ToolCallResult[] = [];
        for (const toolCall of detectedToolCalls) {
          const tool = this.tools.get(toolCall.function.name);

          if (!tool) {
            const errMsg = `Tool "${toolCall.function.name}" not found`;
            // Repair message — explain the failure and tell the model to
            // try a different tool. Cache-safe because we are APPENDING,
            // never modifying existing messages.
            currentMessages.push({
              role: 'system',
              content: `[TOOL_REPAIR] Previous tool_call "${toolCall.function.name}" (id=${toolCall.id}) failed: ${errMsg}. Available tools: ${[...this.tools.keys()].join(', ')}.`,
            });
            currentMessages.push({
              role: 'tool',
              content: errMsg,
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            });
            callResults.push({ name: toolCall.function.name, ok: false, output: errMsg });
            continue;
          }

          try {
            const parsed = JSON.parse(toolCall.function.arguments || '{}');

            // v3.0.5 fix (found in live testing): validate required params
            // BEFORE executing. A missing `content` on file write used to
            // silently create an EMPTY file and report success — the model
            // got no signal to correct itself and re-issued the same broken
            // call. Fail fast with a repair message instead.
            const required = (tool.parameters || []).filter(p => p.required);
            const missing = required
              .filter(p => parsed?.[p.name] === undefined || parsed?.[p.name] === null || parsed?.[p.name] === '')
              .map(p => p.name);
            if (required.length > 0 && missing.length > 0) {
              const errMsg = `[PARAM_ERROR] Missing required parameter(s): ${missing.join(', ')}. Retry the call with all required parameters filled.`;
              currentMessages.push({
                role: 'tool',
                content: errMsg,
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
              });
              currentMessages.push({
                role: 'system',
                content: `[TOOL_REPAIR] Tool "${toolCall.function.name}" was called with missing required parameters (${missing.join(', ')}). Re-issue the call and include them.`,
              });
              callResults.push({ name: toolCall.function.name, ok: false, output: errMsg });
              continue;
            }

            const params = parsed;
            const result = await tool.execute(params, this.toolCtx);
            const output = result.success ? (result.output || JSON.stringify(result.data)) : (result.error || 'Tool failed');

            currentMessages.push({
              role: 'tool',
              content: output,
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            });

            callResults.push({ name: toolCall.function.name, ok: result.success, output });

            if (!result.success) {
              // Soft failure: tool returned success=false. Same repair pattern.
              currentMessages.push({
                role: 'system',
                content: `[TOOL_REPAIR] Tool "${toolCall.function.name}" returned success=false: ${output}. Consider correcting the arguments and retrying.`,
              });
            }
          } catch (error: any) {
            const errMsg = `Error: ${error.message}`;
            currentMessages.push({
              role: 'tool',
              content: errMsg,
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            });
            callResults.push({ name: toolCall.function.name, ok: false, output: errMsg });
            // Hard failure: tool.execute threw. Repair message so the model
            // can see the failure next round and adjust (e.g. fix a path
            // typo, retry without the optional arg).
            currentMessages.push({
              role: 'system',
              content: `[TOOL_REPAIR] Tool "${toolCall.function.name}" threw an exception: ${errMsg}. Inspect the arguments and retry with a corrected call.`,
            });
          }
        }

        // Emit one tool_calls chunk for this iteration, with per-tool results
        // attached (index-aligned). TUI / headless render outcomes from here.
        yield { type: 'tool_calls', toolCalls: detectedToolCalls, results: callResults };
        continue;
      }

      // No tool calls - done. Return final response (with usage if we have it).
      return {
        content: fullContent,
        role: 'assistant',
        usage: lastUsage,
      };
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

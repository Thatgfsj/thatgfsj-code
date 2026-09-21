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
import { createRunawayGuard } from '../utils/runaway.js';

export class LLMService {
  private provider: LLMProvider;
  private tools: Map<string, Tool> = new Map();
  private apiKey: string;
  /** v3.5.0: current model id, for actionable error messages. */
  private model: string;
  /**
   * v3.0.5: execution context handed to every tool (confirmAction, abort
   * signal, working directory). Previously tools were called with no
   * context at all, which made the whole permission pipeline dead code.
   */
  private toolCtx: ToolContext = {};

  constructor(provider: LLMProvider, apiKey: string, model = '') {
    this.provider = provider;
    this.apiKey = apiKey;
    this.model = model;
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

    return new LLMService(provider, providerCfg.apiKey, providerCfg.model);
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
    options?: ChatOptions & {
      maxIterations?: number;
      signal?: AbortSignal;
      /**
       * v3.3.0 (mcode-parity): mirror every message the agent loop adds —
       * assistant tool_calls and each tool result — so the SESSION keeps
       * the tool dimension. Without this the next turn rebuilds its
       * request from a session that has no idea what was read/changed,
       * and the model repeats the work from scratch.
       */
      onMessage?: (msg: ChatMessage) => void;
      /**
       * v3.3.0 (mcode-parity beforeLlmCall): called before EVERY provider
       * round. May return a replacement message array (e.g. after a
       * pre-call context compaction); the loop adopts it for the request.
       */
      beforeRound?: (msgs: ChatMessage[]) => Promise<ChatMessage[] | void> | ChatMessage[] | void;
    }
  ): AsyncGenerator<StreamChunk, ChatResponse> {
    if (!this.hasApiKey()) throw new Error(this.getNoKeyMessage());

    const mirror = (m: ChatMessage): void => {
      try { options?.onMessage?.(m); } catch { /* session persistence must not break the loop */ }
    };

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
    const runaway = createRunawayGuard();
    // v3.5.0: turn-level bookkeeping + failure circuit breaker. The old
    // loop only nudged with a soft reminder and never stopped early, so a
    // model retrying a denied call burned the full 10 rounds (~50k tokens
    // in testing) and the caller still saw success.
    const loopStats: NonNullable<ChatResponse['loopStats']> = {
      rounds: 0, toolCalls: 0, denied: 0, failed: 0,
    };
    let consecutiveFailedRounds = 0;
    const MAX_CONSECUTIVE_FAILED_ROUNDS = 4;

    while (iterations < maxIterations) {
      // v3.3.0: cooperative cancellation — the old loop only aborted the
      // in-flight fetch, so an esc during tool execution still ran every
      // remaining tool of the round AND started the next round.
      if (options?.signal?.aborted) {
        return { content: '[已中断]', role: 'assistant', usage: lastUsage, loopStats };
      }
      iterations++;
      // v3.3.0: pre-round hook — the App layer uses this to compact the
      // context BEFORE the request instead of hitting the window mid-turn
      // (mcode's beforeLlmCall placement).
      try {
        const refreshed = await options?.beforeRound?.(currentMessages);
        if (refreshed) currentMessages = refreshed;
      } catch { /* hook failure must not break the loop */ }
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
        loopStats.rounds += 1;
        loopStats.toolCalls += detectedToolCalls.length;
        let roundHadSuccess = false;
        const roundNotes: string[] = [];
        // v3.0.16 (tool_start pre-launch): announce the calls BEFORE running
        // them. The TUI prints `⎿ name(args) ⟳` immediately instead of
        // waiting for execution to finish (long browser/file tools used to
        // leave a silent gap). Headless consumers skip pending chunks, so
        // the --json event stream still carries exactly ONE tool_calls
        // event per round (with results).
        yield { type: 'tool_calls', toolCalls: detectedToolCalls, pending: true };

        // Add assistant message with tool calls (append-only, preserves prefix cache)
        const assistantToolMsg: ChatMessage = {
          role: 'assistant',
          content: fullContent || '',
          tool_calls: detectedToolCalls,
        };
        currentMessages.push(assistantToolMsg);
        mirror(assistantToolMsg);

        const abortedMidGroup = (): void => {
          // The API requires a result for EVERY tool_call of the assistant
          // message — fill the not-yet-executed ones with a cancelled stub
          // so the next request stays valid. callResults is index-aligned
          // with detectedToolCalls (protocol invariant).
          for (let i = callResults.length; i < detectedToolCalls.length; i++) {
            const tc = detectedToolCalls[i];
            const cancelled: ChatMessage = {
              role: 'tool',
              content: '[cancelled by user]',
              tool_call_id: tc.id,
              name: tc.function.name,
            };
            currentMessages.push(cancelled);
            mirror(cancelled);
            callResults.push({ name: tc.function.name, ok: false, output: '[cancelled by user]' });
          }
        };

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
          // v3.3.0: mid-group abort — stop executing, stub the remaining
          // results so the history stays provider-valid, then unwind.
          if (options?.signal?.aborted) {
            abortedMidGroup();
            yield { type: 'tool_calls', toolCalls: detectedToolCalls, results: callResults };
            return { content: '[已中断]', role: 'assistant', usage: lastUsage, loopStats };
          }
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
            mirror(currentMessages[currentMessages.length - 1]);
            callResults.push({ name: toolCall.function.name, ok: false, output: errMsg });
            continue;
          }

          try {
            const parsed = JSON.parse(toolCall.function.arguments || '{}');
            // v3.3.0 runaway guard: the same call repeating is the model
            // spinning — remind it to change approach (soft nudge only).
            // v3.5.1: the reminder text also rides on the tool_calls chunk
            // as `notes` — headless consumers could not see the guard at
            // all before (field report).
            const runawayHit = runaway.track(toolCall.function.name, toolCall.function.arguments || '');
            if (runawayHit.remind) {
              const reminder = `"${toolCall.function.name}" has now been called ${runawayHit.count} times with IDENTICAL arguments and produced the same outcome. Do not repeat it again: change the approach, use a different tool, or ask the user.`;
              currentMessages.push({
                role: 'system',
                content: `[SYSTEM REMINDER] ${reminder}`,
              });
              roundNotes.push(reminder);
            }

            // v3.0.5 fix (found in live testing): validate required params
            // BEFORE executing. A missing `content` on file write used to
            // silently create an EMPTY file and report success — the model
            // got no signal to correct itself and re-issued the same broken
            // call. Fail fast with a repair message instead.
            // v3.0.18: schema-only tools (e.g. MCP tools) may leave
            // `parameters` empty and declare requirements purely in
            // `inputSchema.required` — fall back to that name list when
            // tool.parameters yields no required names.
            let requiredNames: string[] = (tool.parameters || []).filter(p => p.required).map(p => p.name);
            if (requiredNames.length === 0 && tool.inputSchema?.required?.length) {
              requiredNames = tool.inputSchema.required;
            }
            const missing = requiredNames
              .filter(name => parsed?.[name] === undefined || parsed?.[name] === null || parsed?.[name] === '');
            if (requiredNames.length > 0 && missing.length > 0) {
              const errMsg = `[PARAM_ERROR] Missing required parameter(s): ${missing.join(', ')}. Retry the call with all required parameters filled.`;
              currentMessages.push({
                role: 'tool',
                content: errMsg,
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
              });
              mirror(currentMessages[currentMessages.length - 1]);
              currentMessages.push({
                role: 'system',
                content: `[TOOL_REPAIR] Tool "${toolCall.function.name}" was called with missing required parameters (${missing.join(', ')}). Re-issue the call and include them.`,
              });
              callResults.push({ name: toolCall.function.name, ok: false, output: errMsg });
              continue;
            }

            const params = parsed;
            // v3.0.16: overlay the per-turn AbortSignal onto the shared tool
            // context so cancellation-aware tools (browser) can bail out
            // mid-flight — Ctrl+C no longer leaves a page.goto running.
            const result = await tool.execute(params, { ...this.toolCtx, signal: options?.signal });
            const output = result.success
              ? (result.output || (result.data !== undefined ? JSON.stringify(result.data) : '') || '(no output)')
              : (result.error || 'Tool failed');

            currentMessages.push({
              role: 'tool',
              content: output,
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            });
            mirror(currentMessages[currentMessages.length - 1]);

            callResults.push({ name: toolCall.function.name, ok: result.success, output });

            if (!result.success) {
              // v3.5.0: a cancellation is a permission decision, not a tool
              // fault — count it separately so the circuit breaker can tell
              // "user refused everything" from "tools are broken".
              if (/cancel/i.test(output)) loopStats.denied += 1;
              else loopStats.failed += 1;
              roundHadSuccess = false;
              // Soft failure: tool returned success=false. Same repair pattern.
              currentMessages.push({
                role: 'system',
                content: `[TOOL_REPAIR] Tool "${toolCall.function.name}" returned success=false: ${output}. Consider correcting the arguments and retrying.`,
              });
            } else {
              roundHadSuccess = true;
            }
          } catch (error: any) {
            const errMsg = `Error: ${error.message}`;
            currentMessages.push({
              role: 'tool',
              content: errMsg,
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            });
            mirror(currentMessages[currentMessages.length - 1]);
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
        // (The pre-execution `pending: true` announcement went out above.)
        // v3.5.1: `notes` surfaces runaway-guard reminders to headless logs.
        yield {
          type: 'tool_calls',
          toolCalls: detectedToolCalls,
          results: callResults,
          ...(roundNotes.length > 0 ? { notes: [...roundNotes] } : {}),
        };

        // v3.5.0: circuit breaker — when EVERY call of a round failed or was
        // denied, one more identical attempt is unlikely to help. Stop after
        // MAX_CONSECUTIVE_FAILED_ROUNDS such rounds instead of burning the
        // remaining iterations (a denied task used to spin all 10 rounds).
        if (roundHadSuccess) {
          consecutiveFailedRounds = 0;
        } else {
          consecutiveFailedRounds += 1;
          if (consecutiveFailedRounds >= MAX_CONSECUTIVE_FAILED_ROUNDS) {
            loopStats.abortedReason = `${consecutiveFailedRounds} consecutive rounds had all tool calls fail or be denied (${loopStats.denied} denied, ${loopStats.failed} failed this turn)`;
            return {
              content: `[AGENT_ABORTED] Stopping: ${loopStats.abortedReason}. The task was NOT completed — ask the user for help or different permissions instead of retrying.`,
              role: 'assistant',
              usage: lastUsage,
              loopStats,
            };
          }
        }
        continue;
      }

      // No tool calls - done. Return final response (with usage if we have
      // it). v3.5.1: loopStats rides along on SUCCESS too, so headless
      // consumers always get the per-turn tool accounting.
      return {
        content: fullContent,
        role: 'assistant',
        usage: lastUsage,
        loopStats,
      };
    }

    // v3.5.0: exhausting the loop is an ABORT, not a successful answer —
    // callers used to see this string as a normal assistant message with
    // success:true.
    loopStats.abortedReason = `agent loop exceeded maximum iterations (${maxIterations})`;
    return {
      content: `[AGENT_ABORTED] ${loopStats.abortedReason} without a final answer. The task was NOT completed.`,
      role: 'assistant',
      usage: lastUsage,
      loopStats,
    };
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
    // v3.5.0: name the model. `gfc -m some/model` used to disable the
    // built-in fallback and then blame the missing API key — without ever
    // mentioning that the -m model was the variable that changed.
    const model = this.model ? `模型 "${this.model}" ` : '';
    return [
      `❌ ${model || '调用 AI '}失败：当前服务商未配置 API Key。`,
      '',
      model ? '（该模型来自 -m/--model 参数：确认模型名与所属服务商，或去掉 -m 用内置共享模型）' : '',
      '请先运行: gfcode init',
      '',
      '或设置环境变量:',
      '  export SILICONFLOW_API_KEY="sk-..."',
      '  export OPENAI_API_KEY="sk-..."',
      '  export DEEPSEEK_API_KEY="sk-..."',
    ].filter(l => l !== undefined).join('\n');
  }
}

export type { LLMProvider, ProviderConfig, StreamChunk } from './provider.js';
export { OpenAIProvider } from './openai.js';
export { AnthropicProvider } from './anthropic.js';
export { GeminiProvider } from './gemini.js';

/**
 * App - Core application singleton
 * Simplified: directly uses LLMService (which has built-in agent loop)
 *
 * v3.0.0+: streamResponse yields structured StreamChunk
 *   - runPrompt streams { type: 'text' } chunks to stdout and captures the
 *     final usage for cache stats recording.
 */

import { ConfigManager } from '../config/index.js';
import { LLMService } from '../llm/index.js';
import { SessionManager } from '../session/index.js';
import { ToolRegistry } from '../tools/index.js';
import { HookManager } from '../hooks/index.js';
import { SystemPromptBuilder } from '../prompts/index.js';
import { SkillRegistry } from '../skills/index.js';
import { CacheStatsStore } from '../cache/stats.js';
import { compressThinking } from '../utils/thinking.js';
import type { ChatMessage, ChatResponse, StreamChunk, Usage } from '../types.js';

export class App {
  config: ConfigManager;
  llm: LLMService;
  session: SessionManager;
  tools: ToolRegistry;
  hooks: HookManager;
  prompts: SystemPromptBuilder;
  skills: SkillRegistry;
  /**
   * v3.0.0: persistent cache stats store. The single source of truth for
   * cache hit-rate and estimated savings, surfaced through the TUI Header
   * and the /cache command.
   */
  cacheStats: CacheStatsStore;
  /**
   * v2.2.5 (product 0.4.2): toggle  block compression. Default
   * true. Toggled by `--show-thinking` on the CLI or `/thinking on|off`
   * in the REPL.
   */
  showThinking: boolean = false;

  private constructor(
    config: ConfigManager,
    llm: LLMService,
    session: SessionManager,
    tools: ToolRegistry,
    hooks: HookManager,
    prompts: SystemPromptBuilder,
    skills: SkillRegistry,
    cacheStats: CacheStatsStore,
  ) {
    this.config = config;
    this.llm = llm;
    this.session = session;
    this.tools = tools;
    this.hooks = hooks;
    this.prompts = prompts;
    this.skills = skills;
    this.cacheStats = cacheStats;
  }

  static async create(): Promise<App> {
    const config = await ConfigManager.load();
    const aiConfig = config.getAIConfig();

    const llm = LLMService.fromConfig(aiConfig);
    const cacheStats = new CacheStatsStore();
    const session = new SessionManager(config.get().contextLength || 50);
    // v3.0.0: do not mutate messages when context grows — instead, surface
    // a "consider /new" toast via onSuggestNewSession. The TUI wires this
    // up in app.tsx; in CLI single-prompt mode it's a no-op (one-shot).
    session.onSuggestNewSession = (info) => {
      console.warn(
        `\n  ⚠️  上下文较长（${info.currentLength}/${info.max}）。` +
        `建议调 /new 开新会话（NWT 已自动归档历史）\n`,
      );
    };
    const tools = new ToolRegistry();
    const hooks = new HookManager();
    const skills = new SkillRegistry();

    // Register tools with LLM service
    llm.registerTools(tools.list());

    // Auto-init NWT timeline
    const nwtTool = tools.get('nwt');
    if (nwtTool) {
      await nwtTool.execute({ action: 'init' });
    }

    // Build system prompt with active skills
    const prompts = new SystemPromptBuilder({
      cwd: process.cwd(),
      tools: tools.list(),
      permissionMode: 'ask',
      skillsPrompt: skills.getActivePrompts(),
    });
    session.addMessage('system', prompts.build());

    return new App(config, llm, session, tools, hooks, prompts, skills, cacheStats);
  }

  /**
   * Stream a response for the current session messages.
   * The LLMService handles the full agent loop internally.
   *
   * Yields structured StreamChunks. Returns the final ChatResponse (with usage
   * if the provider reported it) so the caller can record cache stats.
   *
   * Implementation note: we drain the inner stream manually so the final
   * ChatResponse returned by LLMService.chatStream is propagated as this
   * generator's return value. Using yield* doesn't carry the return value
   * through TS's AsyncGenerator<T, R> type inference in this version of
   * TypeScript, so we wrap with an inner for-await and explicit return.
   */
  async *streamResponse(messages?: ChatMessage[]): AsyncGenerator<StreamChunk, ChatResponse> {
    const msgs = messages || this.session.getMessages();
    const inner = this.llm.chatStream(msgs);
    let next = await inner.next();
    while (!next.done) {
      // Forward chunks unchanged, but capture usage into the persistent
      // cache stats store so the TUI Header / /cache command can read it.
      if (next.value && next.value.type === 'usage') {
        try { this.cacheStats.record(next.value.usage); } catch { /* best-effort */ }
      }
      yield next.value;
      next = await inner.next();
    }
    // The generator's return value (ChatResponse with usage) is propagated
    // to callers via `for await ... await streamResponse.next()` semantics.
    return next.value;
  }

  /**
   * Run a single prompt (non-interactive mode)
   *
   * v2.2.4 (port from v2.1.0): persistence of the assistant message
   * uses addMessageSafe, which drops the message if it contains
   * pollution markers like "[已中断]".
   *
   * v2.2.5 (product 0.4.2): persistence also strips  blocks
   * (and similar reasoning delimiters) when showThinking is false,
   * so the conversation log stays compact.
   *
   * v3.0.0: yields structured StreamChunks; final usage is captured
   * into onUsage callback for cache stats persistence.
   */
  async runPrompt(prompt: string, onUsage?: (usage: Usage) => void): Promise<string> {
    this.session.addMessage('user', prompt);

    let fullResponse = '';
    let finalUsage: ChatResponse['usage'] | undefined;
    try {
      for await (const chunk of this.streamResponse()) {
        if (chunk.type === 'text' && chunk.content) {
          process.stdout.write(chunk.content);
          fullResponse += chunk.content;
        } else if (chunk.type === 'usage') {
          finalUsage = chunk.usage;
        }
      }
    } catch (err) {
      // Re-throw without persisting partial response. Persisting
      // truncated output here was the source of the [已中断] loop in
      // v2.2.3.
      throw err;
    }

    console.log();
    // v2.2.5: compress  blocks before persisting.
    const toPersist = compressThinking(fullResponse, this.showThinking);
    this.session.addMessageSafe('assistant', toPersist);

    // v3.0.0: forward usage to caller (CLI single-shot mode records stats too)
    if (finalUsage && onUsage) {
      try { onUsage(finalUsage); } catch { /* best-effort */ }
    }
    return fullResponse;
  }
}

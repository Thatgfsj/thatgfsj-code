/**
 * App - Core application singleton
 *
 * v3.0.5 wiring release:
 *   - MCP: servers from ~/.thatgfsj/mcp.json are connected at startup
 *     (per-server failures are non-fatal) and their tools join the
 *     registry before the system prompt is built. Child processes are
 *     disconnected on exit.
 *   - Permission pipeline: tool confirmations now actually reach the UI —
 *     App owns the mode ('ask' default, 'accept' via --yolo) and a
 *     pluggable confirmHandler (TUI prompt / headless auto-deny). With no
 *     handler and 'ask' mode, write/execute tool calls are DENIED instead
 *     of silently executed.
 *   - reloadModel(): /model hot-swaps provider+model without restarting;
 *     tools and the system prompt are rebuilt, TTL resolution resets.
 *   - applyTtl(): /ttl takes effect immediately (config + provider marker).
 *   - streamResponse() accepts an AbortSignal that reaches the provider
 *     fetch calls, so cancelling a round stops token generation.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ConfigManager } from '../config/index.js';
import { recordModelUse } from '../config/modelHistory.js';
import { PROVIDERS, MODEL_CATALOGS, getApiKeyFromEnv, isCustomProvider } from '../config/providers.js';
import type { Config, ProviderName } from '../config/types.js';
import { LLMService } from '../llm/index.js';
import { SessionManager, sanitizeLoadedMessages } from '../session/index.js';
import { ToolRegistry } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';
import { SystemPromptBuilder } from '../prompts/index.js';
import { SkillRegistry } from '../skills/index.js';
import { CacheStatsStore } from '../cache/stats.js';
import { compressThinking } from '../utils/thinking.js';
import { estimateTokens } from '../utils/tokens.js';
import { MCPServerManager, type McpConfigFile } from '../mcp/client.js';
import { createGetContextTool } from '../tools/context.js';
import type { ChatMessage, ChatResponse, StreamChunk, Usage } from '../types.js';

/** Read ~/.thatgfsj/mcp.json. Missing or corrupted file = no servers. */
export function loadMcpConfig(): McpConfigFile {
  const p = join(homedir(), '.thatgfsj', 'mcp.json');
  if (!existsSync(p)) return {};
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8'));
    if (data && typeof data === 'object') return data as McpConfigFile;
    return {};
  } catch {
    return {};
  }
}

/** Confirmation request handed to the active UI. */
export interface ConfirmRequest {
  /** Human-readable description of the action, including a diff preview when relevant. */
  message: string;
}

export class App {
  config: ConfigManager;
  llm: LLMService;
  session: SessionManager;
  tools: ToolRegistry;
  prompts: SystemPromptBuilder;
  skills: SkillRegistry;
  /**
   * v3.0.0: persistent cache stats store. The single source of truth for
   * cache hit-rate and estimated savings, surfaced through the TUI Header
   * and the /cache command.
   */
  cacheStats: CacheStatsStore;
  /** v3.0.5: connected MCP servers (empty manager when none configured). */
  mcp: MCPServerManager;
  /** v3.0.5: startup results per configured MCP server, for /mcp output. */
  mcpStartupResults: Array<{ name: string; ok: boolean; error?: string; tools: number }> = [];
  /**
   * v2.2.5: toggle thinking block compression. Default true. Toggled by
   * `--show-thinking` on the CLI or `/thinking on|off` in the REPL.
   */
  showThinking: boolean = false;
  /**
   * v3.0.3: TTL resolved per session. null = not yet decided (auto mode
   * waiting for first round). After the first chatStream completes, this
   * is '5m' or '1h' and stays sticky.
   */
  resolvedTtl: '5m' | '1h' | null = null;
  /**
   * v3.0.13: session-wide token accounting, surfaced in the status bar.
   * promptTokens keeps the LAST round's value (= current context size);
   * completionTokens accumulates across rounds.
   */
  sessionStats = { promptTokens: 0, completionTokens: 0, rounds: 0 };
  /**
   * v3.0.5: permission mode. 'ask' requires confirmation for write/execute
   * tool actions; 'accept' (--yolo) allows everything.
   * v3.1.0: 'plan' — read-only research mode: confirmable actions are
   * auto-denied while the model researches and drafts a plan; approval
   * transitions to 'accept'.
   */
  permissionMode: 'ask' | 'accept' | 'plan' = 'ask';
  /**
   * v3.0.5: pluggable confirmation UI. The TUI installs an Ink prompt;
   * headless mode leaves it unset → write/execute actions are denied with
   * a note (add --yolo to allow them).
   */
  confirmHandler?: (req: ConfirmRequest) => Promise<boolean>;
  /** v3.1.2: true when getAIConfig fell back to the built-in shared model. */
  usingBuiltinModel: boolean = false;
  /**
   * v3.1.0: fired by useChat when a streaming turn actually finishes (NOT
   * when isThinking flips false — that happens at the first token). The TUI
   * uses it to offer plan approval after each turn in plan mode.
   */
  onTurnComplete?: () => void;

  private constructor(
    config: ConfigManager,
    llm: LLMService,
    session: SessionManager,
    tools: ToolRegistry,
    prompts: SystemPromptBuilder,
    skills: SkillRegistry,
    cacheStats: CacheStatsStore,
    mcp: MCPServerManager,
  ) {
    this.config = config;
    this.llm = llm;
    this.session = session;
    this.tools = tools;
    this.prompts = prompts;
    this.skills = skills;
    this.cacheStats = cacheStats;
    this.mcp = mcp;
  }

  static async create(): Promise<App> {
    const config = await ConfigManager.load();
    const aiConfig = config.getAIConfig();
    const usingBuiltinModel = !!aiConfig.usingBuiltinKey;

    const llm = LLMService.fromConfig(aiConfig);
    const cacheStats = new CacheStatsStore();
    // v3.4.2: startup must honor the per-model contextLength written by the
    // /models dialog (modelSettings[model].contextLength). It used to be
    // saved but never consumed — the session window stayed at the global
    // default while the dialog displayed the new value.
    const session = new SessionManager(effectiveContextLength(config.get()));
    // Default toast goes to stderr so it can not corrupt the Ink frame;
    // the TUI replaces this with a proper in-app message.
    session.onAutoCompact = (info) => {
      process.stderr.write(
        `\n  ⚠️  上下文较长（${info.before} 条），已自动压缩到 ${info.after} 条。可随时 /new 开新会话（NWT 已自动归档历史）\n`,
      );
    };
    const tools = new ToolRegistry();
    const skills = new SkillRegistry();
    let mcpResults: App['mcpStartupResults'] = [];

    // v3.0.5: connect MCP servers BEFORE the prompt is built so their tools
    // are visible to the model from turn one. A failing server is logged,
    // never fatal.
    const mcp = new MCPServerManager();
    const mcpConfig = loadMcpConfig();
    const mcpServerDefs = mcpConfig.mcpServers || mcpConfig.servers || {};
    if (Object.keys(mcpServerDefs).length > 0) {
      appLog('正在连接 MCP 服务器…');
      mcpResults = await mcp.connectFromConfig(mcpConfig);
      for (const r of mcpResults) {
        if (r.ok) {
          appLog(`✓ MCP ${r.name}（${r.tools} 个工具）`);
        } else {
          appLog(`✗ MCP ${r.name}: ${r.error}`);
        }
      }
      for (const tool of mcp.getAllTools()) {
        tools.register(tool);
      }
    }
    // Kill MCP child processes on exit (also covers Ctrl+C via 'exit').
    process.on('exit', () => {
      try { mcp.disconnectAll(); } catch { /* best-effort */ }
    });

    // Register tools with LLM service (after MCP tools joined the registry)
    llm.registerTools(tools.list());

    // Auto-init NWT timeline
    const nwtTool = tools.get('nwt');
    if (nwtTool) {
      await nwtTool.execute({ action: 'init' });
    }

    // Build system prompt with the FULL tool list (including MCP tools)
    const prompts = new SystemPromptBuilder({
      cwd: process.cwd(),
      tools: tools.list(),
      permissionMode: 'ask',
      skillsPrompt: skills.getActivePrompts(),
    });
    const app = new App(config, llm, session, tools, prompts, skills, cacheStats, mcp);
    app.mcpStartupResults = mcpResults;
    app.usingBuiltinModel = usingBuiltinModel;

    // v3.0.20: model-facing context self-check (Codex get_context_remaining
    // parity). Registered here because the numbers live on the App singleton;
    // the prompt builder below takes tools.list() AFTER this so the tool is
    // documented to the model from turn one.
    tools.register(createGetContextTool(() => ({
      used: app.sessionStats.promptTokens,
      window: app.getContextWindow(),
    })));
    llm.registerTools(tools.list());
    prompts.setTools(tools.list());

    // v3.0.5: route tool confirmations through App (mode + handler aware)
    app.applyToolContext();

    session.addMessage('system', prompts.build());

    return app;
  }

  /**
   * v3.0.5: keep registry and LLMService tool contexts in sync. All asks
   * funnel through requestConfirmation so the permission mode and the
   * active UI handler apply uniformly.
   */
  private applyToolContext(): void {
    const ctx: ToolContext = {
      workingDirectory: process.cwd(),
      confirmAction: (msg: string) => this.requestConfirmation({ message: msg }),
      confirmEdit: (info) => this.requestConfirmation({ message: info.message }),
      // v3.1.0: plan-mode gate for tools that bypass confirmAction entirely.
      readOnly: () => this.permissionMode === 'plan',
    };
    this.tools.setContext(ctx);
    this.llm.setToolContext(ctx);
  }

  /**
   * v3.0.5: central permission decision.
   * - 'accept' mode (--yolo): always allowed.
   * - handler installed (TUI): ask it, 60s timeout denies.
   * - no handler (headless): deny with a hint on stderr.
   */
  async requestConfirmation(req: ConfirmRequest): Promise<boolean> {
    if (this.permissionMode === 'accept') return true;
    if (this.permissionMode === 'plan') {
      // Plan mode is read-only: deny without prompting so the model gets an
      // immediate "cancelled" signal and falls back to research + planning.
      // No stderr note here on purpose — mid-stream writes corrupt the Ink
      // frame; the tool's own cancel message reaches the transcript instead.
      return false;
    }
    if (!this.confirmHandler) {
      process.stderr.write(
        `\n  ⛔ 已拒绝：${firstLine(req.message)}\n     （headless 模式默认拒绝写入/执行操作；如需放行请加 --yolo）\n`,
      );
      return false;
    }
    try {
      const answer = await Promise.race([
        this.confirmHandler(req),
        new Promise<boolean>((resolve) => {
          const t = setTimeout(() => resolve(false), 60000);
          t.unref?.();
        }),
      ]);
      return !!answer;
    } catch {
      return false;
    }
  }

  /**
   * v3.0.5: single entry for toggling auto-accept. Also refreshes the
   * system prompt's permission-mode section so the model knows tool calls
   * no longer need user approval.
   */
  setYolo(on: boolean): void {
    this.permissionMode = on ? 'accept' : 'ask';
    this.rebuildSystemPrompt();
  }

  /**
   * v3.1.0: plan mode toggle (/计划模式). Read-only research + planning;
   * the TUI's plan-approval overlay transitions to 'accept' on approval.
   */
  setPlanMode(on: boolean): void {
    this.permissionMode = on ? 'plan' : 'ask';
    this.rebuildSystemPrompt();
  }

  /** v3.1.0: enter full-permission (red) mode directly (/完整权限模式). */
  setFullPermission(): void {
    this.permissionMode = 'accept';
    this.rebuildSystemPrompt();
  }

  /**
   * v3.0.5: hot-swap the model (and provider, if /provider changed it on
   * disk). Rebuilds LLMService, re-registers every current tool, resets TTL
   * resolution and refreshes the system prompt. /model previously only
   * wrote the config file and required a restart.
   */
  async reloadModel(): Promise<void> {
    const aiConfig = this.config.getAIConfig();
    const llm = LLMService.fromConfig(aiConfig);
    llm.registerTools(this.tools.list());
    this.llm = llm;
    this.resolvedTtl = null;
    // v3.4.2: refresh the built-in fallback flag — configuring a key used
    // to leave the stale "未配置 API Key" splash banner on screen.
    this.usingBuiltinModel = !!aiConfig.usingBuiltinKey;
    // v3.4.2: live-apply the new model's per-model contextLength, mirroring
    // the startup path (setModelContextLength only handled the same-model case).
    const c = this.config.get();
    this.session.setMaxMessages(effectiveContextLength(c));
    this.applyToolContext();
    this.rebuildSystemPrompt();
  }

  /**
   * v3.4.2: single entry for switching models (the /model picker, /model <id>,
   * and the /models dialog all funnel here). Saves provider+model+key
   * together, records provider-tagged history and hot-reloads.
   */
  async switchModel(model: string, opts?: { provider?: ProviderName; apiKey?: string }): Promise<void> {
    const updates: Partial<Config> = { model };
    if (opts?.provider) updates.provider = opts.provider;
    if (opts?.apiKey !== undefined) updates.apiKey = opts.apiKey;
    await this.config.save(updates);
    recordModelUse(model, this.config.get().provider);
    await this.reloadModel();
  }

  /**
   * v3.4.2: resolve which provider a model id belongs to across all known
   * catalogs. Returns [] when unknown (custom relay models, free text).
   */
  findModelOwners(modelId: string): ProviderName[] {
    const owners: ProviderName[] = [];
    for (const [name, catalog] of Object.entries(MODEL_CATALOGS)) {
      if (catalog.some(m => m.id === modelId)) owners.push(name as ProviderName);
    }
    return owners;
  }

  /**
   * v3.4.2: /model <id> with ownership validation. Returns an error notice
   * instead of silently mis-routing when the id clearly belongs to another
   * provider whose key we don't have.
   */
  async switchModelChecked(modelId: string): Promise<string> {
    const c = this.config.get();
    const knownHere = MODEL_CATALOGS[c.provider]?.some(m => m.id === modelId)
      || (c.customModels || []).includes(modelId)
      || modelId === c.model
      || !!process.env.MODEL;
    let notice: string;
    if (knownHere || isCustomProvider(c.provider)) {
      await this.switchModel(modelId);
      notice = `模型 → ${modelId}（立即生效）`;
      if (!knownHere && !isCustomProvider(c.provider)) {
        notice += `（未知模型，已按当前服务商 ${c.provider} 设置）`;
      }
    } else {
      const owners = this.findModelOwners(modelId).filter(p => p !== c.provider);
      const candidate = owners[0];
      if (candidate) {
        const pc = PROVIDERS[candidate];
        const envKey = getApiKeyFromEnv(candidate);
        if (pc.keyless || envKey) {
          await this.switchModel(modelId, { provider: candidate, ...(envKey ? { apiKey: envKey } : {}) });
          return `模型 → ${candidate} / ${modelId}（已自动切换服务商，立即生效）`;
        }
        return [
          `✗ ${modelId} 属于 ${pc.name}，但当前服务商是 ${c.provider}，且没有该服务商的 API Key。`,
          `  请先 /服务商 重新配置，或设置环境变量 ${pc.envKeys[0]}。`,
        ].join('\n');
      }
      // Unknown id — user manages a relay catalog or a brand-new model; trust
      // them but keep it under the current provider.
      await this.switchModel(modelId);
      notice = `模型 → ${modelId}（未知模型，已按当前服务商 ${c.provider} 设置）`;
    }
    // v3.4.2: switching to a provider we hold no key for used to silently
    // fall back to the builtin shared model — say it out loud instead.
    const after = this.config.get();
    if (!after.apiKey && !PROVIDERS[after.provider]?.keyless) {
      const hasOtherKey = Object.keys(after.apiKeys || {}).length > 0;
      notice += `\n⚠ 该服务商尚未配置 API Key，请求会失败。/服务商 配置 Key${hasOtherKey ? '，或 /模型 Qwen/Qwen3.5-4B 暂用内置共享模型' : ''}。`;
    }
    return notice;
  }

  /**
   * v3.0.5: apply a TTL pin immediately (config write-through + provider
   * marker). /ttl previously only updated a display value; the wire format
   * kept the old TTL until restart.
   */
  async applyTtl(ttl: '5m' | '1h'): Promise<void> {
    const current = this.config.get().cache ?? { enabled: true, strategy: 'auto' as const };
    await this.config.save({ cache: { ...current, ttl } });
    this.llm.setTtl(ttl);
    this.resolvedTtl = ttl;
  }

  /** v3.0.5: rebuild the system prompt (tools / permission mode changed). */
  rebuildSystemPrompt(): void {
    this.prompts.setTools(this.tools.list());
    this.prompts.setPermissionMode(this.permissionMode);
    const built = this.prompts.build();
    this.session.replaceSystemMessage(built);
  }

  // ── v3.0.8: model settings (per-model thinking / context length, custom models)

  /** Effective thinking effort for a model: per-model override → 'off'. */
  getThinking(modelId?: string): 'off' | 'low' | 'medium' | 'high' {
    const c = this.config.get();
    const id = modelId || c.model;
    return c.modelSettings?.[id]?.thinking ?? 'off';
  }

  async setModelThinking(modelId: string, thinking: 'off' | 'low' | 'medium' | 'high'): Promise<void> {
    const c = this.config.get();
    const ms = { ...(c.modelSettings || {}) };
    ms[modelId] = { ...ms[modelId], thinking };
    await this.config.save({ modelSettings: ms });
  }

  async setModelContextLength(modelId: string, n: number): Promise<void> {
    const c = this.config.get();
    const ms = { ...(c.modelSettings || {}) };
    ms[modelId] = { ...ms[modelId], contextLength: n };
    await this.config.save({ modelSettings: ms });
    // Live-apply when editing the CURRENT model's session window.
    if (modelId === c.model) {
      this.session.setMaxMessages(n);
    }
  }

  async addCustomModel(id: string): Promise<void> {
    const c = this.config.get();
    const list = [...new Set([...(c.customModels || []), id.trim()])].filter(Boolean);
    await this.config.save({ customModels: list });
  }

  async removeCustomModel(id: string): Promise<void> {
    const c = this.config.get();
    const list = (c.customModels || []).filter(m => m !== id);
    await this.config.save({ customModels: list });
  }

  /** Models available in the picker: current + custom additions. */
  listConfiguredModels(): string[] {
    const c = this.config.get();
    return [...new Set([c.model, ...(c.customModels || [])])].filter(Boolean);
  }

  // ── v3.0.13: token-aware auto-compact ─────────────────────

  /** Context window (tokens) for a model: per-model override → default 128k. */
  getContextWindow(modelId?: string): number {
    const c = this.config.get();
    const id = modelId || c.model;
    return c.modelSettings?.[id]?.contextWindow ?? c.contextWindow ?? 128000;
  }

  async setModelContextWindow(modelId: string, tokens: number): Promise<void> {
    const c = this.config.get();
    const ms = { ...(c.modelSettings || {}) };
    ms[modelId] = { ...ms[modelId], contextWindow: tokens };
    await this.config.save({ modelSettings: ms });
  }

  /**
   * v3.0.13: auto-compact when the last round's prompt tokens reach 85% of
   * the model's context window. Compaction keeps the most recent complete
   * tool groups (see session/compactor) so the next request stays valid.
   * Returns a user-facing notice when compaction ran, null otherwise.
   */
  maybeAutoCompact(usage?: Usage): string | null {
    if (!usage?.prompt_tokens || usage.prompt_tokens <= 0) return null;
    const win = this.getContextWindow();
    const ratio = usage.prompt_tokens / win;
    if (ratio < 0.85) return null;
    const r = this.session.compactNow();
    if (!r) {
      return `⚠️ 上下文已用 ${Math.round(ratio * 100)}%（${usage.prompt_tokens}/${win} tokens），但没有可压缩的历史。建议 /new 开新会话。`;
    }
    return `⚠️ 上下文接近模型窗口（${Math.round(ratio * 100)}%），已自动压缩：${r.before} → ${r.after} 条（工具调用块保持完整）。建议之后找机会 /new。`;
  }

  /**
   * v3.0.5: TUI hook-up — show MCP startup results as an in-chat message.
   * Returns a short multi-line report (empty when no servers configured).
   */
  mcpStatusText(): string {
    const configured = Object.keys(loadMcpConfig().mcpServers || loadMcpConfig().servers || {}).length;
    if (configured === 0) {
      return [
        'MCP 未配置。配置文件: ~/.thatgfsj/mcp.json',
        '',
        '  {',
        '    "mcpServers": {',
        '      "名称": { "command": "npx", "args": ["-y", "包名"] }',
        '    }',
        '  }',
        '',
        '（兼容 "servers" 键名；修改后重启生效）',
      ].join('\n');
    }
    const lines = ['MCP 服务器:'];
    for (const r of this.mcpStartupResults) {
      lines.push(r.ok
        ? `  ✓ ${r.name} — ${r.tools} 个工具`
        : `  ✗ ${r.name} — ${r.error}`);
    }
    const status = this.mcp.getStatus();
    if (status.length > 0) {
      lines.push('');
      lines.push('当前状态:');
      for (const s of status) {
        const toolList = s.tools.length > 0
          ? s.tools.slice(0, 8).join(', ') + (s.tools.length > 8 ? ` 等 ${s.tools.length} 个` : '')
          : '(无工具)';
        lines.push(`  ${s.connected ? '●' : '○'} ${s.name}: ${toolList}`);
      }
    }
    return lines.join('\n');
  }

  /**
   * v3.3.0 (mcode-parity beforeLlmCall): estimate the NEXT request's size
   * (system assembly + full history) and compact BEFORE the request when
   * it would overflow the window — the old check ran only at turn end on
   * the previous round's usage, so a single tool-heavy turn could blow
   * through the window mid-turn and hard-fail with a provider 400.
   * Returns refreshed messages when compaction ran, null otherwise.
   */
  preCallContextCheck(msgs: ChatMessage[]): ChatMessage[] | null {
    const win = this.getContextWindow();
    if (win <= 0) return null;
    let bd = { systemPrompt: 0, systemTools: 0, mcpTools: 0, skills: 0 };
    try { bd = this.prompts.estimateBreakdown(); } catch { /* stubs in tests */ }
    let est = bd.systemPrompt + bd.systemTools + bd.mcpTools + bd.skills + 64;
    for (const m of msgs) {
      const c = m.content;
      est += estimateTokens(typeof c === 'string' ? c : JSON.stringify(c ?? '')) + 4;
      if (m.tool_calls) {
        for (const tc of m.tool_calls) est += estimateTokens(tc.function?.arguments || '') + 8;
      }
    }
    const cfg = (this.config.get() as any);
    const maxTokens = cfg.maxTokens ?? 4096;
    const triggerAt = win - Math.max(16384, maxTokens + 2048);
    if (est <= triggerAt) return null;
    const r = this.session.compactNow();
    if (!r) return null;
    return sanitizeLoadedMessages(this.session.getMessages());
  }

  /**
   * Stream a response for the current session messages.
   * The LLMService handles the full agent loop internally.
   *
   * Yields structured StreamChunks. Returns the final ChatResponse (with usage
   * if the provider reported it) so the caller can record cache stats.
   *
   * v3.0.5: accepts { signal } — propagated into provider fetch calls so
   * cancellation actually aborts the HTTP request.
   * v3.3.0: session mode mirrors agent-loop messages (tool dimension)
   * back into the session, sanitizes the assembled history, and runs the
   * pre-call context check before every round.
   */
  async *streamResponse(messages?: ChatMessage[], opts?: { signal?: AbortSignal }): AsyncGenerator<StreamChunk, ChatResponse> {
    const sessionMode = !messages;
    const msgs = messages
      ? messages
      : sanitizeLoadedMessages(this.session.getMessages());
    // v3.0.8: per-model thinking effort rides along with every request.
    const inner = this.llm.chatStream(msgs, {
      signal: opts?.signal,
      thinking: this.getThinking(),
      // v3.3.0: keep the session's memory complete (tool dimension) and
      // compact before each round instead of after the window is gone.
      onMessage: sessionMode
        ? (m) => { try { this.session.addMessage(m.role, typeof m.content === 'string' ? m.content : JSON.stringify(m.content), m); } catch { /* never break the loop */ } }
        : undefined,
      beforeRound: sessionMode
        ? async (cur) => this.preCallContextCheck(cur) ?? undefined
        : undefined,
    });
    const debugUsage = !!process.env.GFCODE_DEBUG_USAGE;
    // v3.0.3: read TTL the LLMService resolved this round (sticky per session).
    this.resolvedTtl = this.llm.getResolvedTTL();
    let next = await inner.next();
    while (!next.done) {
      // Forward chunks unchanged, but capture usage into the persistent
      // cache stats store so the TUI Header / /cache command can read it.
      if (next.value && next.value.type === 'usage') {
        try { this.cacheStats.record(next.value.usage); } catch { /* best-effort */ }
        // v3.0.13: session token accounting for the status bar.
        try {
          const u = next.value.usage;
          if (u.prompt_tokens > 0) this.sessionStats.promptTokens = u.prompt_tokens;
          this.sessionStats.completionTokens += u.completion_tokens || 0;
          this.sessionStats.rounds += 1;
        } catch { /* best-effort */ }
        if (debugUsage) {
          process.stderr.write(
            '[debug_usage] ' + JSON.stringify(next.value.usage) + '\n'
          );
        }
      }
      yield next.value;
      next = await inner.next();
    }
    return next.value;
  }

  /**
   * Run a single prompt (non-interactive mode)
   *
   * v2.2.4: persistence of the assistant message uses addMessageSafe, which
   * drops the message if it contains pollution markers like "[已中断]".
   *
   * v3.0.0: yields structured StreamChunks; final usage is captured.
   * v3.0.5: persists the session to disk when the round completes.
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
    const toPersist = compressThinking(fullResponse, this.showThinking);
    this.session.addMessageSafe('assistant', toPersist);
    this.session.persist();

    if (finalUsage && onUsage) {
      try { onUsage(finalUsage); } catch { /* best-effort */ }
    }
    return fullResponse;
  }
}

// ---- helpers ------------------------------------------------------------

function appLog(msg: string): void {
  // Startup messages go to stderr so they never corrupt Ink / --json stdout.
  process.stderr.write(`  ${msg}\n`);
}

function firstLine(s: string): string {
  const line = s.split('\n').find(l => l.trim()) || s;
  return line.length > 120 ? line.slice(0, 120) + '…' : line;
}

/**
 * v3.4.2: effective session window for a config — per-model
 * modelSettings[model].contextLength wins, then the global contextLength,
 * then 50. Single source so startup, hot-reload and live edits agree.
 */
export function effectiveContextLength(c: Config): number {
  const perModel = c.modelSettings?.[c.model]?.contextLength;
  return perModel ?? c.contextLength ?? 50;
}

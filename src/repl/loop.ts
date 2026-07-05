/**
 * REPL Loop
 * Main interactive loop with streaming support
 *
 * S07-fix:
 *   - 输入端换用 REPLInput (基于 @inquirer/input),支持方向键/小键盘
 *   - 流式输出保留完整内容(用户可滚动终端查看历史),不跳顶不刷屏
 *   - Ctrl+C 行为:有未提交内容=>清空当前输入;空输入两次=>退出
 */

import chalk from 'chalk';
import readline from 'readline';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { REPLInput, type PromptResult } from './input.js';
import { REPLOutput } from './output.js';
import { WelcomeScreen } from './welcome.js';
import { AIEngine } from '../core/ai-engine.js';
import { SessionManager } from '../core/session.js';
import { ConfigManager } from '../core/config.js';
import { SystemPromptBuilder } from '../core/system-prompt.js';
import { getBuiltInTools } from '../tools/index.js';
import type { Config } from '../core/types.js';

/**
 * One entry in ~/.thatgfsj/models.json (added in 0.3.0).
 */
export interface SavedModel {
  /** Model id used in API requests, e.g. `Qwen3-32B` or `claude-sonnet-4-5`. */
  id: string;
  /** Unix ms timestamp when this entry was last written. Defaults to 0
   *  on legacy entries; `appendSavedModel` always overwrites it with
   *  `Date.now()` at write time. */
  addedAt?: number;
  /** Optional context-window length in MiB (the `ctx` field). */
  ctx?: number;
  /** Optional thinking-effort hint: 'none' | 'low' | 'medium' | 'high' | 'max'. */
  thinking?: 'none' | 'low' | 'medium' | 'high' | 'max';
  /** Optional free-form note (e.g. "Q4 quantized via openrouter"). */
  note?: string;
}

export class REPLLoop {
  private input: REPLInput;
  private output: REPLOutput;
  private ai: AIEngine | null = null;
  private session: SessionManager | null = null;
  private running: boolean = false;
  // Used to abort an in-flight AI stream when the user presses Ctrl+C twice
  private streamAbort: AbortController | null = null;

  constructor() {
    this.input = new REPLInput();
    this.output = new REPLOutput();
  }

  /**
   * Initialize the REPL
   * S04: Use SystemPromptBuilder for dynamic prompt construction
   */
  async init(): Promise<void> {
    const config = await ConfigManager.load();

    this.ai = new AIEngine(config);

    const builtInTools = getBuiltInTools();
    for (const tool of builtInTools) {
      this.ai!.registerTool(tool);
    }

    this.session = new SessionManager();

    const promptBuilder = new SystemPromptBuilder({
      cwd: process.cwd(),
      tools: builtInTools,
      permissionMode: 'ask'
    });
    const systemPrompt = promptBuilder.build();

    this.session.addMessage('system', systemPrompt);

    this.running = true;

    // 全局 SIGINT 处理:第一次按下 abort 当前 AI stream,第二次退出 REPL
    process.on('SIGINT', () => {
      if (this.streamAbort) {
        this.streamAbort.abort();
        this.streamAbort = null;
        this.output.stopSpinner();
        this.output.printWarning('\n⏹  Generation cancelled (Ctrl+C again to exit)');
        return;
      }
      // 没有在生成:模拟一次 cancel 计数,以便空输入连续两次 Ctrl+C 可以退出 REPL
      // (原本这里只打 warning,导致 Ctrl+C 完全退出不了,本修复把决策权交回给 REPLInput)
      const shouldExit = this.input.requestCancel();
      if (shouldExit) {
        this.output.printInfo('\n👋 Goodbye!');
        this.running = false;
      } else {
        this.output.printWarning('\n(press Ctrl+C again on an empty prompt to exit)');
      }
    });
  }

  /**
   * Start the REPL loop
   */
  async start(): Promise<void> {
    await this.init();

    this.output.clear();
    this.output.printBanner();
    this.output.printInfo('\nType "help" for available commands\n');
    this.output.printDivider();

    while (this.running) {
      let result: PromptResult;
      try {
        result = await this.input.prompt();
      } catch (err: any) {
        this.output.printError(err?.message ?? String(err));
        continue;
      }

      if (result.kind === 'cancelled') {
        if (this.input.shouldExitOnCancel()) {
          this.output.printInfo('\n👋 Goodbye!');
          this.running = false;
          break;
        }
        // 继续让用户输入
        continue;
      }

      // input layer 自动重置 cancel 计数,无需手动调

      // Trim and unwrap accidentally-pasted quoted prompts like `""` or `''`
      // — common when the user copy-pastes from a markdown example.
      let userInput = result.value;
      userInput = userInput.replace(/^["'](.*)["']$/s, '$1').trim();
      if (!userInput) continue;

      const handled = await this.handleCommand(userInput);
      if (handled) continue;

      await this.processInput(userInput);
    }

    // 清理全局监听
    process.removeAllListeners('SIGINT');
  }

  /**
   * Handle built-in commands
   *
   * Accepts bare words, slash-prefixed forms (`/model`), AND Chinese aliases
   * (`/模型`, `/提供商`, `/帮助`, `/清除`, `/退出`, `/历史`, `/工具`).
   * The Chinese forms mirror thatgfsj-code@1.0.4 behaviour.
   */
  private async handleCommand(input: string): Promise<boolean> {
    // Strip leading slash and full-width slash; trim whitespace; lowercase.
    const cmd = input
      .replace(/^\//, '')
      .replace(/^／/, '')
      .toLowerCase()
      .trim();

    switch (cmd) {
      // ── Session control ────────────────────────────────────────────
      case 'exit':
      case 'quit':
      case '退出':
      case '\\x03':
        this.output.printInfo('\n👋 Goodbye!');
        this.running = false;
        return true;

      case 'clear':
      case '清除':
      case '清屏':
        this.output.clear();
        this.output.printBanner();
        return true;

      // ── Inspection ─────────────────────────────────────────────────
      case 'context':
      case '上下文':
        this.showContext();
        return true;

      case 'history':
      case '历史':
        this.showHistory();
        return true;

      case 'tools':
      case '工具':
        this.showTools();
        return true;

      case 'help':
      case '帮助':
        this.output.printHelp();
        return true;

      case 'models':
      case 'providers':
      case '模型列表':
      case '提供商':
        // read-only listing
        this.showProviders();
        return true;

      // ── Switching (interactive picker, actually mutates config) ────
      case 'model':
      case '模型':
        await this.handleModelSwitch();
        return true;

      case 'provider':
      case '提供商切换':
      case '切换':
        await this.handleProviderSwitch();
        return true;

      case 'edit':
      case '修改':
        // /edit [n] — directly jump to the edit wizard. With no arg,
        // shows the saved-model list first (same as /model).
        await this.runEditShortcut();
        return true;

      default:
        return false;
    }
  }

  /**
   * Process user input with AI (S01: streaming, no prompt reset)
   *
   * 关键修复:
   *   - 不再调用 rl.question,所以不会 reset 终端
   *   - chunk 直接 process.stdout.write,完整保留所有输出,用户可滚动查看
   *   - spinner 在第一个 chunk 到达时停止,然后正常流式
   */
  private async processInput(input: string): Promise<void> {
    if (!this.ai || !this.session) {
      this.output.printError('AI not initialized');
      return;
    }

    this.session.addMessage('user', input);

    // 视觉提示用户:AI 开始工作,但不阻塞,可滚动
    this.output.printInfo(chalk.gray('🤖 Thinking...\n'));

    let fullResponse = '';
    let firstChunk = true;
    this.streamAbort = new AbortController();

    try {
      const stream = this.ai.chatStream(this.session.getMessages());
      for await (const chunk of stream) {
        if (firstChunk) {
          // 第一个 chunk 到来,把 "Thinking..." 那行通过 ANSI 清除
          // 但不能清光——只把光标移到下一行的开头即可,内容自然出现在前面
          firstChunk = false;
        }
        // 关键:直接 stdout.write,允许任意长度、可滚动
        process.stdout.write(chunk);
        fullResponse += chunk;

        if (this.streamAbort.signal.aborted) break;
      }

      console.log(); // 流结束换行
    } catch (error: any) {
      if (error?.name === 'AbortError' || this.streamAbort.signal.aborted) {
        console.log();
        this.output.printWarning('[cancelled]');
      } else {
        this.output.printError(error.message);
      }
    } finally {
      this.streamAbort = null;
    }

    const accepted = this.session.addMessage('assistant', fullResponse);
    if (!accepted) {
      this.output.printWarning(
        chalk.yellow(
          `⚠️  上轮回复包含 "[已中断]" 等污染标记,已自动丢弃以避免循环。本次回复不会基于它继续;请重说你的问题。\n` +
          `(本次会话已累计过滤 ${this.session.getDroppedCount()} 条污染消息)`
        )
      );
    }
    this.session.truncate(20);
  }

  private showContext(): void {
    const cwd = process.cwd();
    this.output.printHeader('📁 Project Context');
    this.output.printInfo(`Working directory: ${cwd}`);
  }

  private showHistory(): void {
    const items = this.input.getHistory();
    this.output.printHeader('📜 Command History');
    if (items.length === 0) {
      this.output.printInfo('(no history yet)');
      return;
    }
    items.forEach((h, i) => this.output.printInfo(`  ${i + 1}. ${h}`));
  }

  private showTools(): void {
    this.output.printHeader('🔧 Available Tools');
    this.output.printInfo('  file    - File operations (read, write, list, delete)');
    this.output.printInfo('  shell   - Execute shell commands');
    this.output.printInfo('  git     - Git operations (coming soon)');
  }

  private showProviders(): void {
    this.output.printHeader('🌐 Available Providers (read-only — use /provider to switch)');
    this.output.printInfo('  siliconflow  - 硅基流动 (default)');
    this.output.printInfo('  minimax     - MiniMax M2.5');
    this.output.printInfo('  openai      - OpenAI GPT');
    this.output.printInfo('  anthropic   - Anthropic Claude');
    this.output.printInfo('  gemini      - Google Gemini');
    this.output.printInfo('  kimi        - Moonshot Kimi');
    this.output.printInfo('  deepseek    - DeepSeek');
    this.output.printInfo('  ernie       - 文心一言 ERNIE');
    this.output.printInfo('  ollama      - 本地模型');
  }

  /**
   * /model — main entry point for model management.
   *
   * 0.3.0 UX (per user feedback):
   *   - 先看到的是**已经保存的模型** (从 ~/.thatgfsj/models.json 读)，
   *     而不是内置 provider 列表。
   *   - 列表末尾是 `+ 添加新模型` 选项 → 触发完整向导
   *     (provider → api_key → baseUrl(可选,用于中转站) → model_name →
   *      context length (M) → thinking effort)。
   *   - 顶部有 `edit` 模式,可以重新修改任意已保存模型。
   *   - 选某条 saved model 后立即切换并退出；按 Enter 不变。
   *   - 兼容 0.2.x / 1.0.4 老 history:
   *     - 字符串数组会透明迁移成 {id,...} 形式。
   *     - 内置模型 (`Qwen3-32B` 之类) 也可选择,作为「saved + builtin」展示。
   */
  private async handleModelSwitch(): Promise<void> {
    if (!this.ai || !this.session) return;

    const currentConfig = this.ai.getConfig();
    const provider = currentConfig.provider || 'siliconflow';
    const builtin = WelcomeScreen.getModelsForProvider(provider);
    const saved = this.loadSavedModels();
    const currentModel = currentConfig.model || builtin[0]?.id;

    const RECENT_LIMIT = 8;
    // Most-recent first (exclude the current one in the listing — it's
    // surfaced separately as the active row).
    const recents = [...saved]
      .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
      .filter(m => m.id !== currentModel)
      .slice(0, RECENT_LIMIT);

    this.output.printHeader(`🤖 /model — 切换 / 管理模型 (provider: ${provider})`);

    // 当前
    if (currentModel) {
      const curSaved = saved.find(m => m.id.toLowerCase() === currentModel.toLowerCase());
      const meta = curSaved && (curSaved.ctx || curSaved.thinking)
        ? chalk.gray(`  ctx=${curSaved.ctx ?? '-'}M thinking=${curSaved.thinking ?? '-'}`)
        : '';
      this.output.printInfo(chalk.green(`  ⮕ 当前: ${currentModel}`) + meta);
    }

    // 已保存
    if (recents.length > 0) {
      this.output.printInfo('');
      this.output.printInfo(chalk.yellow('  已保存模型:'));
      recents.forEach((m, idx) => {
        const meta = [];
        if (m.ctx)    meta.push(`ctx=${m.ctx}M`);
        if (m.thinking) meta.push(`think=${m.thinking}`);
        const extra = meta.length ? chalk.gray(`  [${meta.join(' · ')}]`) : '';
        this.output.printInfo(`  ${(idx + 1).toString().padStart(2)}. ${chalk.cyan(m.id)}${extra}`);
      });
    } else {
      this.output.printInfo('');
      this.output.printInfo(chalk.gray('  (尚无保存的模型)'));
    }

    // 添加 / 编辑 提示
    this.output.printInfo('');
    this.output.printInfo(chalk.yellow('  操作:'));
    this.output.printInfo(`  a. ${chalk.cyan('+ 添加新模型')}    (完整向导: provider → key → url → 名称 → ctx → thinking)`);
    if (recents.length > 0) {
      this.output.printInfo(`  e. ${chalk.cyan('edit <编号>')}     (修改已保存模型的 ctx / thinking / 备注)`);
    }
    if (builtin.length > 0) {
      this.output.printInfo(chalk.gray(`  或输入编号 1-${recents.length} 切换到对应已保存模型;直接回车保持当前。`));
    }

    const choice = await this.askOnce(
      chalk.cyan('\nmodel > ') + (recents[0]?.id ? `${recents[0].id} (1) / a / e / id` : 'a / id'),
    );
    if (choice === null) {
      this.output.printInfo(chalk.gray('(已取消,保持当前模型)'));
      return;
    }
    if (choice === '') {
      this.output.printInfo(chalk.gray('(保持当前模型)'));
      return;
    }

    const trimmed = choice.trim().toLowerCase();

    // === 添加新模型 ===
    if (trimmed === 'a' || trimmed === '+' || trimmed === 'add') {
      await this.runAddModelWizard();
      return;
    }

    // === 编辑已保存 ===
    const editMatch = /^e(?:dit)?\s*(\d+)$/.exec(trimmed);
    if (editMatch) {
      const k = Number.parseInt(editMatch[1], 10) - 1;
      const target = recents[k];
      if (!target) {
        this.output.printError('编号超出范围。');
        return;
      }
      await this.runEditModelWizard(target);
      return;
    }

    // === 数字 — 已保存模型中的第 k 个 ===
    if (/^\d+$/.test(trimmed)) {
      const k = Number.parseInt(trimmed, 10) - 1;
      const target = recents[k];
      if (!target) {
        this.output.printError(`编号超出范围 (1-${recents.length} 或 a / edit).`);
        return;
      }
      await this.applyModelSwitch(target.id);
      this.appendSavedModel(target);
      const meta = target.ctx || target.thinking
        ? chalk.gray(` (ctx=${target.ctx ?? '-'}M, think=${target.thinking ?? '-'})`)
        : '';
      this.output.printSuccess(`模型已切换为: ${target.id}${meta}`);
      this.session.addMessage(
        'system',
        `[system: model switched to ${target.id}. Continue with the task.]`,
      );
      return;
    }

    // === 自由输入 id ===
    if (trimmed === '') {
      this.output.printInfo(chalk.gray('(保持当前模型)'));
      return;
    }

    // 把裸输入当成 model id(兼容老的 /model Qwen3-32B 行为)
    await this.applyModelSwitch(trimmed);
    this.appendSavedModel({ id: trimmed });
    this.output.printSuccess(`模型已切换为: ${trimmed}  (新保存)`);
    this.session.addMessage(
      'system',
      `[system: model switched to ${trimmed}. Continue with the task.]`,
    );
  }

  /**
   * Add-model wizard (0.3.0+):
   *   Step 1: Provider (内置 / custom_openai / custom_anthropic)
   *   Step 2: API Key (内置:给注册链接;custom:无)
   *   Step 3: Base URL (仅 custom_*;内置跳过)
   *   Step 4: 模型名称 (自由输入)
   *   Step 5: 上下文长度 (MiB,数字,默认 8)
   *   Step 6: 思考强度 (none / low / medium / high / max,默认 none)
   *
   * 完成后:写入 ~/.thatgfsj/models.json,顺便把新模型切到当前,
   * 更新 AIEngine + 写入 ~/.thatgfsj/config.json model 字段。
   */
  private async runAddModelWizard(): Promise<void> {
    if (!this.ai) return;

    this.output.printHeader('➕ 添加新模型');

    // Step 1: provider
    const providers = [
      { id: 'siliconflow',     name: '硅基流动 (SiliconFlow, OpenAI 兼容)' },
      { id: 'openai',          name: 'OpenAI' },
      { id: 'anthropic',       name: 'Anthropic (Claude, Anthropic Messages)' },
      { id: 'minimax',         name: 'MiniMax (M3)' },
      { id: 'gemini',          name: 'Google Gemini' },
      { id: 'kimi',            name: 'Kimi (Moonshot AI)' },
      { id: 'deepseek',        name: 'DeepSeek' },
      { id: 'ernie',           name: '文心一言 (ERNIE)' },
      { id: 'custom_openai',   name: '自定义 → OpenAI 兼容 (中转站)' },
      { id: 'custom_anthropic', name: '自定义 → Anthropic 兼容 (中转站)' },
    ];

    this.output.printInfo('  步骤 1/6: 选择 provider');
    providers.forEach((p, i) => {
      this.output.printInfo(`    ${(i + 1).toString().padStart(2)}. ${p.name}`);
    });
    const provIdx = await this.askChoice('选择编号 (1-10): ', 1, 1, providers.length);
    if (provIdx === null) return;
    const provider = providers[provIdx - 1];

    // Step 2: api key
    let apiKey = '';
    this.output.printInfo(`\n  步骤 2/6: API Key  (provider: ${provider.name})`);
    if (provider.id.startsWith('custom_')) {
      this.output.printInfo('    (中转站模式: 这一步可选,直接回车表示使用 baseUrl 自身的鉴权头)');
    }
    const keyRaw = await this.askOnce('  API Key (输入或回车跳过): ');
    if (keyRaw === null) return;
    apiKey = keyRaw.trim();

    // Step 3: baseUrl (only custom_*)
    let baseUrl: string | undefined;
    if (provider.id === 'custom_openai' || provider.id === 'custom_anthropic') {
      this.output.printInfo('\n  步骤 3/6: baseUrl (中转站 URL)');
      this.output.printInfo(chalk.gray('    例如: https://api.example.com/v1'));
      const url = await this.askOnce('  baseUrl: ');
      if (url === null || !url.trim()) {
        this.output.printError('需要 baseUrl 才能保存自定义 provider。');
        return;
      }
      baseUrl = url.trim();
    }

    // Step 4: model name
    this.output.printInfo('\n  步骤 4/6: 模型名称');
    const modelId = await this.askOnce('  模型 id (例如 gpt-4.1-mini, claude-sonnet-4-5): ');
    if (modelId === null || !modelId.trim()) {
      this.output.printError('模型名称不能为空。已取消。');
      return;
    }
    const model = modelId.trim();

    // Step 5: context length
    this.output.printInfo('\n  步骤 5/6: 上下文长度 (MiB)');
    this.output.printInfo(chalk.gray('    常见的 8 / 32 / 128 / 200;默认 8'));
    const ctxRaw = await this.askOnce('  ctx (M): ');
    let ctx: number | undefined;
    if (ctxRaw !== null && ctxRaw.trim()) {
      const n = Number.parseInt(ctxRaw.trim(), 10);
      if (Number.isFinite(n) && n > 0) ctx = n;
    }
    if (!ctx) ctx = 8;

    // Step 6: thinking effort
    this.output.printInfo('\n  步骤 6/6: 思考强度');
    this.output.printInfo(chalk.gray('    none / low / medium / high / max (默认 none)'));
    const thinkRaw = await this.askOnce('  thinking: ');
    let thinking: SavedModel['thinking'];
    const t = (thinkRaw ?? '').trim().toLowerCase();
    if (t === 'low' || t === 'medium' || t === 'high' || t === 'max') thinking = t;
    else if (t === 'none' || t === '') thinking = 'none';
    else {
      this.output.printWarning(`未识别的 thinking 值 "${t}", 按 none 处理。`);
      thinking = 'none';
    }

    // 持久化 + 切换
    const saved: SavedModel = {
      id: model,
      addedAt: Date.now(),
      ctx,
      thinking,
      note: provider.id,
    };
    this.appendSavedModel(saved);

    // 同步切到当前模型,顺带把 provider/baseUrl 写入 config.json
    await this.applyProviderSwitchInternal(provider.id, baseUrl, apiKey);
    await this.applyModelSwitch(model);

    this.output.printSuccess(
      `已保存并切换到: ${model}  (ctx=${ctx}M, thinking=${thinking}, provider=${provider.id}${baseUrl ? ', baseUrl=' + baseUrl : ''})`,
    );
    this.session?.addMessage(
      'system',
      `[system: model ${model} added (ctx=${ctx}M, thinking=${thinking}, provider=${provider.id}). Continue with the task.]`,
    );
  }

  /**
   * Edit-model wizard (0.3.0+): pick a saved model and update ctx /
   * thinking / note without leaving the REPL.
   */
  private async runEditModelWizard(target: SavedModel): Promise<void> {
    this.output.printHeader(`✏️  修改已保存模型: ${target.id}`);
    this.output.printInfo(chalk.gray(`  provider=${target.note ?? '?'}, ctx=${target.ctx ?? '?'}M, thinking=${target.thinking ?? '?'}`));
    this.output.printInfo('  输入新值;直接回车保留旧值;输入 `-` 清空字段');
    this.output.printInfo('');

    const ctxRaw = await this.askOnce(`  ctx (M) [${target.ctx ?? '?'}]: `);
    if (ctxRaw === null) return;
    const ctxTrim = ctxRaw.trim();
    let newCtx = target.ctx;
    if (ctxTrim === '-') newCtx = undefined;
    else if (ctxTrim !== '') {
      const n = Number.parseInt(ctxTrim, 10);
      if (Number.isFinite(n) && n > 0) newCtx = n;
      else this.output.printWarning(`ctx 未识别 ("${ctxTrim}"), 保留 ${target.ctx}。`);
    }

    const thinkRaw = await this.askOnce(`  thinking [${target.thinking ?? 'none'}]: `);
    if (thinkRaw === null) return;
    const thinkTrim = thinkRaw.trim().toLowerCase();
    let newThinking = target.thinking;
    if (thinkTrim === '-') newThinking = undefined;
    else if (['none', 'low', 'medium', 'high', 'max'].includes(thinkTrim)) newThinking = thinkTrim as any;
    else if (thinkTrim !== '') this.output.printWarning(`thinking 未识别 ("${thinkRaw}"), 保留 ${target.thinking ?? 'none'}。`);

    const noteRaw = await this.askOnce(`  note [${target.note ?? ''}]: `);
    if (noteRaw === null) return;
    const noteTrim = noteRaw.trim();
    let newNote = target.note;
    if (noteTrim === '-') newNote = undefined;
    else if (noteTrim !== '') newNote = noteTrim;

    const updated: SavedModel = {
      ...target,
      ctx: newCtx,
      thinking: newThinking,
      note: newNote,
    };
    this.replaceSavedModel(target.id, updated);
    this.output.printSuccess(`已更新: ${target.id}`);
    this.output.printInfo(chalk.gray(`  ctx=${newCtx ?? '-'}M, thinking=${newThinking ?? '-'}, note=${newNote ?? '-'}`));
  }

  /**
   * Persist a provider choice + custom baseUrl + apiKey into
   * ~/.thatgfsj/config.json and reload AIEngine config. Differs from
   * applyProviderSwitch in that this also writes a custom baseUrl.
   */
  private async applyProviderSwitchInternal(
    providerId: string,
    baseUrl: string | undefined,
    apiKey: string,
  ): Promise<void> {
    if (!this.ai) return;
    const cfg = await this.readPersistedConfig();
    cfg.provider = providerId as Config['provider'];
    if (baseUrl) cfg.baseUrl = baseUrl;
    if (apiKey)  cfg.apiKey = apiKey;
    await this.persistConfig(cfg);
    const next = await ConfigManager.load();
    this.ai.updateConfig(next);
  }

  /**
   * Read ~/.thatgfsj/models.json — a list of saved models the user has
   * previously switched to or added. Starting from 0.3.0 each entry is
   * `{ id, addedAt, ctx?, thinking?, note? }`. Older releases stored a
   * flat array of strings; we transparently migrate that on read.
   */
  private loadModelHistory(): string[] {
    // Kept for backward compat with existing call sites. Returns just the
    // model ids, newest last.
    return this.loadSavedModels().map(m => m.id);
  }

  /**
   * Read ~/.thatgfsj/models.json as a list of SavedModel entries.
   * Migrates v0.2.x's `["id1","id2"]` shape into 0.3.0's `{id,...}` shape
   * on the fly, leaving the on-disk file untouched until a write happens.
   */
  private loadSavedModels(): SavedModel[] {
    try {
      const p = join(homedir(), '.thatgfsj', 'models.json');
      if (!existsSync(p)) return [];
      const raw = JSON.parse(readFileSync(p, 'utf-8'));
      if (!Array.isArray(raw)) return [];

      // v0.3.0+: [{id, ctx?, thinking?}, ...]
      const looksLikeObjects = raw.length > 0 && raw[0] && typeof raw[0] === 'object';
      if (looksLikeObjects) {
        return raw
          .filter(x => x && typeof x === 'object' && typeof x.id === 'string')
          .map((x: any) => ({
            id: x.id,
            addedAt: typeof x.addedAt === 'number' ? x.addedAt : 0,
            ctx: typeof x.ctx === 'number' ? x.ctx : undefined,
            thinking: typeof x.thinking === 'string' ? x.thinking : undefined,
            note: typeof x.note === 'string' ? x.note : undefined,
          }));
      }
      // v0.2.x: ["id1", "id2", ...] — migrate in memory only.
      return (raw as unknown[])
        .filter(x => typeof x === 'string')
        .map(id => ({ id: id as string, addedAt: 0 }));
    } catch {
      return [];
    }
  }

  /**
   * Legacy helper: append a model id to ~/.thatgfsj/models.json.
   * New callers should prefer `appendSavedModel` so we don't lose
   * ctx / thinking metadata.
   */
  private appendModelHistory(modelId: string): void {
    this.appendSavedModel({ id: modelId });
  }

  /**
   * Persist a SavedModel into ~/.thatgfsj/models.json, replacing any
   * existing entry with the same id (case-insensitive). The original
   * casing of the entry is preserved — i.e. if the user already has
   * `Qwen3-32B` saved and types `qwen3-32b`, the canonical `Qwen3-32B`
   * casing is kept. Newest entries go at the tail of the file.
   */
  private appendSavedModel(model: SavedModel): void {
    try {
      const dir = join(homedir(), '.thatgfsj');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const p = join(dir, 'models.json');
      const list = this.loadSavedModels();
      const existing = list.find(m => m.id.toLowerCase() === model.id.toLowerCase());
      const filtered = list.filter(m => m.id.toLowerCase() !== model.id.toLowerCase());
      const canonical: SavedModel = {
        ...(existing ?? {}),
        ...model,
        id: existing?.id ?? model.id,            // canonical casing wins
        addedAt: Date.now(),
      };
      filtered.push(canonical);
      writeFileSync(p, JSON.stringify(filtered, null, 2));
    } catch {
      // best-effort
    }
  }

  /** Replace an existing saved model entry (matched by id). */
  private replaceSavedModel(id: string, patch: Partial<SavedModel>): void {
    try {
      const dir = join(homedir(), '.thatgfsj');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const p = join(dir, 'models.json');
      const list = this.loadSavedModels();
      const idx = list.findIndex(m => m.id.toLowerCase() === id.toLowerCase());
      if (idx < 0) return;
      list[idx] = { ...list[idx], ...patch, id: list[idx].id, addedAt: list[idx].addedAt };
      writeFileSync(p, JSON.stringify(list, null, 2));
    } catch {
      // best-effort
    }
  }

  /**
   * /provider — interactive provider picker. After provider selection,
   * delegates to /model so the user can also pick a new model for the new provider.
   */
  private async handleProviderSwitch(): Promise<void> {
    if (!this.ai || !this.session) return;

    const currentConfig = this.ai.getConfig();
    const providers: Array<{ id: string; name: string; envKey: string }> = [
      { id: 'siliconflow', name: 'SiliconFlow (推荐)', envKey: 'SILICONFLOW_API_KEY' },
      { id: 'minimax',    name: 'MiniMax',             envKey: 'MINIMAX_API_KEY' },
      { id: 'openai',     name: 'OpenAI',              envKey: 'OPENAI_API_KEY' },
      { id: 'anthropic',  name: 'Anthropic',           envKey: 'ANTHROPIC_API_KEY' },
      { id: 'gemini',     name: 'Google Gemini',       envKey: 'GEMINI_API_KEY' },
      { id: 'kimi',       name: 'Kimi (Moonshot AI)',  envKey: 'KIMI_API_KEY' },
      { id: 'deepseek',   name: 'DeepSeek',            envKey: 'DEEPSEEK_API_KEY' },
      { id: 'ernie',      name: '文心一言 (ERNIE)',     envKey: 'ERNIE_API_KEY' },
      { id: 'custom_openai',   name: '自定义 → OpenAI 兼容 (中转站)', envKey: 'CUSTOM_API_KEY' },
      { id: 'custom_anthropic', name: '自定义 → Anthropic 兼容 (中转站)', envKey: 'CUSTOM_API_KEY' },
    ];

    this.output.printHeader('🌐 /provider — 切换提供商');
    providers.forEach((p, idx) => {
      const mark = p.id === currentConfig.provider ? '  ✓' : '';
      this.output.printInfo(`  ${(idx + 1).toString().padStart(2)}. ${p.name.padEnd(28)} ${chalk.gray(p.id)}${mark}`);
    });
    this.output.printInfo('');
    this.output.printInfo('输入编号或 provider id,直接回车保持当前。');

    const choice = await this.askOnce(chalk.cyan('provider > ') + (currentConfig.provider ?? ''));
    if (choice === null) {
      this.output.printInfo(chalk.gray('(已取消,保持当前 provider)'));
      return;
    }

    const idx = Number.parseInt(choice, 10);
    const pickedProvider =
      (Number.isInteger(idx) && providers[idx - 1]) ||
      providers.find(p => p.id === choice);

    if (!pickedProvider) {
      this.output.printError(`未识别: "${choice}". 保持当前 provider。`);
      return;
    }

    if (pickedProvider.id === currentConfig.provider) {
      this.output.printInfo(chalk.gray('(同一个 provider,无需切换)'));
      return;
    }

    // 自定义 provider 走完整向导,内置 provider 只切 + 提示 key
    if (pickedProvider.id.startsWith('custom_')) {
      this.output.printInfo(chalk.cyan(`\n  切换到 ${pickedProvider.id},需要 baseUrl:`));
      const url = await this.askOnce('  baseUrl (例如 https://api.example.com/v1): ');
      if (!url || !url.trim()) {
        this.output.printError('需要 baseUrl,已取消。');
        return;
      }
      const keyRaw = await this.askOnce(`  API Key (可回车跳过,env ${pickedProvider.envKey} 也行): `);
      await this.applyProviderSwitchInternal(
        pickedProvider.id,
        url.trim(),
        (keyRaw ?? '').trim(),
      );
      this.output.printSuccess(`provider 已切换为: ${pickedProvider.name} (${pickedProvider.id})`);
      this.session.addMessage(
        'system',
        `[system: provider switched to ${pickedProvider.id} (baseUrl=${url.trim()}).]`,
      );
      await this.handleModelSwitch();
      return;
    }

    // 内置 provider
    const envHasKey = !!process.env[pickedProvider.envKey];
    let cfgHasKey = false;
    try {
      const cfgPath = join(homedir(), '.thatgfsj', 'config.json');
      if (existsSync(cfgPath)) {
        const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
        cfgHasKey = !!(cfg.apiKey) && (cfg.provider === pickedProvider.id || !cfg.provider);
      }
    } catch {}

    if (!envHasKey && !cfgHasKey) {
      this.output.printWarning(
        `未检测到 ${pickedProvider.envKey}。运行 \`gfcode init\` 设置,或 export ${pickedProvider.envKey}=... 后重试。`,
      );
    }

    await this.applyProviderSwitch(pickedProvider.id);
    this.output.printSuccess(`provider 已切换为: ${pickedProvider.name} (${pickedProvider.id})`);

    this.session.addMessage(
      'system',
      `[system: provider switched to ${pickedProvider.id}. Picking a new model…]`,
    );
    await this.handleModelSwitch();
  }

  /**
   * /edit [n] — short-hand for the edit wizard.
   *   `/edit`           → list saved models, ask which to edit.
   *   `/edit 1`         → jump to wizard for saved model #1.
   *   `/edit Qwen3-32B` → jump to wizard for the model whose id matches.
   */
  private async runEditShortcut(): Promise<void> {
    if (!this.ai) return;
    const saved = this.loadSavedModels().sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
    if (saved.length === 0) {
      this.output.printWarning('没有已保存的模型。先用 /model 添加几条。');
      return;
    }
    this.output.printHeader('✏️  /edit — 修改已保存模型');
    saved.forEach((m, i) => {
      const meta = [];
      if (m.ctx) meta.push(`ctx=${m.ctx}M`);
      if (m.thinking) meta.push(`think=${m.thinking}`);
      const extra = meta.length ? chalk.gray(`  [${meta.join(' · ')}]`) : '';
      this.output.printInfo(`  ${(i + 1).toString().padStart(2)}. ${chalk.cyan(m.id)}${extra}`);
    });
    this.output.printInfo('');
    const arg = await this.askOnce('  编号或完整 id: ');
    if (arg === null) return;
    const trimmed = arg.trim();
    let target: SavedModel | null = null;
    if (/^\d+$/.test(trimmed)) {
      target = saved[Number.parseInt(trimmed, 10) - 1] ?? null;
    } else {
      target = saved.find(m => m.id.toLowerCase() === trimmed.toLowerCase()) ?? null;
    }
    if (!target) {
      this.output.printError(`未识别: "${trimmed}".`);
      return;
    }
    await this.runEditModelWizard(target);
  }

  /**
   * Persist a model choice and update the running AIEngine.
   */
  private async applyModelSwitch(modelId: string): Promise<void> {
    if (!this.ai) return;
    const cfg = await this.readPersistedConfig();
    cfg.model = modelId;
    await this.persistConfig(cfg);
    const next = await ConfigManager.load();
    this.ai.updateConfig(next);
  }

  /**
   * Persist a provider choice (with the corresponding baseUrl from PROVIDERS
   * map) and update the running AIEngine.
   */
  private async applyProviderSwitch(providerId: string): Promise<void> {
    if (!this.ai) return;
    const cfg = await this.readPersistedConfig();
    cfg.provider = providerId as Config['provider'];
    await this.persistConfig(cfg);
    const next = await ConfigManager.load();
    this.ai.updateConfig(next);
  }

  /**
   * Read the on-disk config; if no file exists, derive a starting config
   * from the current AIEngine state.
   */
  private async readPersistedConfig(): Promise<Config> {
    try {
      const cfgPath = join(homedir(), '.thatgfsj', 'config.json');
      if (existsSync(cfgPath)) {
        return JSON.parse(readFileSync(cfgPath, 'utf-8'));
      }
    } catch {}
    if (this.ai) {
      const snap = this.ai.getConfig();
      return {
        provider: snap.provider as Config['provider'],
        model: snap.model,
        apiKey: snap.apiKey ?? '',
        baseUrl: snap.baseUrl,
        temperature: snap.temperature ?? 0.7,
        maxTokens: snap.maxTokens ?? 4096,
      };
    }
    return {
      provider: 'siliconflow',
      model: 'Qwen/Qwen2.5-7B-Instruct',
      temperature: 0.7,
      maxTokens: 4096,
      apiKey: '',
    };
  }

  private async persistConfig(cfg: Config): Promise<void> {
    const dir = join(homedir(), '.thatgfsj');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
  }

  /**
   * Resolve either a numeric index or a model id to a model entry.
   */
  private resolveModelChoice(
    choice: string,
    models: ReadonlyArray<{ id: string; name: string; desc: string }>,
  ): { id: string; name: string; desc: string } | null {
    const trimmed = choice.trim();
    const idx = Number.parseInt(trimmed, 10);
    if (Number.isInteger(idx) && models[idx - 1]) return models[idx - 1];
    return models.find(m => m.id === trimmed) ?? null;
  }

  /**
   * Wrap readline in a one-shot prompt. Returns the trimmed answer, or
   * `null` if the user pressed Ctrl+C (does not throw).
   */
  private askOnce(prefix: string): Promise<string | null> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
      const onSigint = () => {
        rl.close();
        resolve(null);
      };
      rl.once('SIGINT', onSigint);
      rl.question(prefix, (answer) => {
        rl.removeListener('SIGINT', onSigint);
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  /**
   * Validate-and-collect a numeric choice within `[min..max]`. Accepts
   * empty input as `defaultValue`. Returns `null` on Ctrl+C.
   */
  private async askChoice(prefix: string, defaultValue: number, min: number, max: number): Promise<number | null> {
    while (true) {
      const raw = await this.askOnce(prefix);
      if (raw === null) return null;
      if (raw === '') return defaultValue;
      const n = Number.parseInt(raw, 10);
      if (Number.isInteger(n) && n >= min && n <= max) return n;
      this.output.printWarning(`请输入 ${min}-${max} 之间的整数。`);
    }
  }

  /**
   * Stop the REPL
   */
  stop(): void {
    this.running = false;
    if (this.streamAbort) {
      this.streamAbort.abort();
      this.streamAbort = null;
    }
    this.output.stopStreaming();
  }

  /**
   * Handle interrupt (Ctrl+C) while streaming
   */
  interrupt(): void {
    if (this.streamAbort) {
      this.streamAbort.abort();
      this.streamAbort = null;
    }
    this.output.stopStreaming();
  }
}

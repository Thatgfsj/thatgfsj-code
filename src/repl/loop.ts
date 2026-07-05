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

      const userInput = result.value;
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
   */
  private async handleCommand(input: string): Promise<boolean> {
    // Allow both bare words (mirrors REPL UI) and /slash-prefixed forms
    // (legacy / 1.0.4 habit), e.g. `/model` or `/provider`.
    const cmd = input.replace(/^\//, '').toLowerCase().trim();

    switch (cmd) {
      case 'exit':
      case 'quit':
      case '\\x03':
        this.output.printInfo('\n👋 Goodbye!');
        this.running = false;
        return true;

      case 'clear':
        this.output.clear();
        this.output.printBanner();
        return true;

      case 'context':
        this.showContext();
        return true;

      case 'history':
        this.showHistory();
        return true;

      case 'tools':
        this.showTools();
        return true;

      case 'help':
        this.output.printHelp();
        return true;

      case 'models':
        // Bare read-only listing (legacy alias for "/provider")
        this.showProviders();
        return true;

      case 'providers':
        this.showProviders();
        return true;

      case 'model':
        // Interactive picker — actually switches the model
        await this.handleModelSwitch();
        return true;

      case 'provider':
        // Interactive picker — switches provider, then asks for model
        await this.handleProviderSwitch();
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
   * /model — interactive model picker for the currently-active provider.
   * Persists the choice to ~/.thatgfsj/config.json and updates the running
   * AIEngine so subsequent requests use the new model immediately. Also
   * appends the picked model id to ~/.thatgfsj/models.json so it shows up
   * as a recent option across sessions (mirrors the 1.0.4 behaviour).
   *
   * The user can:
   *   1. Enter the numbered index of a built-in choice
   *   2. Paste an exact model id (matched against the provider's model list,
   *      recent history, OR the current model)
   *   3. Type any free-form model id to switch to a custom model
   *   4. Press Enter with empty input to keep the current model
   *   5. Press Ctrl+C to cancel
   */
  private async handleModelSwitch(): Promise<void> {
    if (!this.ai || !this.session) return;

    const currentConfig = this.ai.getConfig();
    const provider = currentConfig.provider || 'siliconflow';
    const builtin = WelcomeScreen.getModelsForProvider(provider);
    const history = this.loadModelHistory();
    const currentModel = currentConfig.model || builtin[0]?.id;

    // Build the displayed list: recent history first (newest), then
    // built-in models (dedup), with a trailing "+ add new" entry.
    const RECENT_LIMIT = 5;
    const recents = history.filter(id => id !== currentModel).slice(0, RECENT_LIMIT);

    this.output.printHeader(`🤖 /model — 切换模型 (provider: ${provider})`);

    if (recents.length > 0) {
      this.output.printInfo(chalk.yellow('  最近使用:'));
      recents.forEach((id, idx) => {
        const mark = id === currentModel ? '  ✓' : '';
        this.output.printInfo(
          `  r${idx + 1}. ${chalk.cyan(id)}${mark}`,
        );
      });
    }

    this.output.printInfo('');
    this.output.printInfo('  内置模型:');
    builtin.forEach((m, idx) => {
      const mark = m.id === currentModel ? '  ✓' : '';
      this.output.printInfo(
        `  ${(idx + 1).toString().padStart(2)}. ${m.name.padEnd(28)} ${chalk.gray(m.id)}${mark}`,
      );
    });

    this.output.printInfo('');
    this.output.printInfo(
      chalk.gray(
        '输入编号(r1-r' + recents.length + ' / 1-' + builtin.length +
        ')、完整 model id、或直接贴一个新 id。回车保持当前。',
      ),
    );

    const choice = await this.askOnce(chalk.cyan('model > ') + (currentModel ?? ''));
    if (choice === null) {
      this.output.printInfo(chalk.gray('(已取消,保持当前模型)'));
      return;
    }
    if (choice === '') {
      this.output.printInfo(chalk.gray('(保持当前模型)'));
      return;
    }

    let pickedId: string | null = null;

    // Recent-history shortcut: "r1" .. "r<N>"
    const recentMatch = /^r(\d+)$/i.exec(choice);
    if (recentMatch) {
      const k = Number.parseInt(recentMatch[1], 10) - 1;
      pickedId = recents[k] ?? null;
    }
    // Numeric index into builtin
    else if (/^\d+$/.test(choice)) {
      const k = Number.parseInt(choice, 10) - 1;
      pickedId = builtin[k]?.id ?? null;
      if (!pickedId) {
        this.output.printError(`编号超出范围: "${choice}". 保持当前模型。`);
        return;
      }
    }
    // Exact id match against builtin
    else if (builtin.find(m => m.id === choice)) {
      pickedId = choice;
    }
    // Exact id match against recent history
    else if (recents.includes(choice)) {
      pickedId = choice;
    }
    // Free-form — treat as a custom model id
    else {
      pickedId = choice;
      this.output.printInfo(chalk.gray(`(未识别,按自定义模型处理: ${pickedId})`));
    }

    if (!pickedId) {
      this.output.printError(`未识别: "${choice}". 保持当前模型。`);
      return;
    }

    await this.applyModelSwitch(pickedId);
    this.appendModelHistory(pickedId);
    const builtinMatch = builtin.find(m => m.id === pickedId);
    const display = builtinMatch
      ? `${builtinMatch.name}  (${builtinMatch.id})`
      : `${pickedId}  (自定义)`;
    this.output.printSuccess(`模型已切换为: ${display}`);
    this.session.addMessage(
      'system',
      `[system: model switched to ${pickedId}. Continue with the task.]`,
    );
  }

  /**
   * Read ~/.thatgfsj/models.json — a flat array of model ids the user has
   * previously switched to. Order is "most recent last" in the file but the
   * caller treats it as time-ordered.
   */
  private loadModelHistory(): string[] {
    try {
      const p = join(homedir(), '.thatgfsj', 'models.json');
      if (!existsSync(p)) return [];
      const raw = JSON.parse(readFileSync(p, 'utf-8'));
      return Array.isArray(raw) ? raw.filter(x => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  /**
   * Append a model id to ~/.thatgfsj/models.json, deduping the trailing
   * entry. Mirrors the 1.0.4 behaviour: history is "things you switched to".
   */
  private appendModelHistory(modelId: string): void {
    try {
      const dir = join(homedir(), '.thatgfsj');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const p = join(dir, 'models.json');
      let history: string[] = [];
      if (existsSync(p)) {
        try { history = JSON.parse(readFileSync(p, 'utf-8')); } catch { history = []; }
      }
      if (!Array.isArray(history)) history = [];
      const filtered = history.filter(x => typeof x === 'string' && x !== modelId);
      filtered.push(modelId);
      writeFileSync(p, JSON.stringify(filtered, null, 2));
    } catch {
      // best-effort: history persistence is not critical
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

    // 校验 API Key 存在(从 env 或 ~/.thatgfsj/config.json)
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
        `未检测到 ${pickedProvider.envKey}。运行 \`gfcode init\` 设置，或 export ${pickedProvider.envKey}=... 后重试。`,
      );
      // 仍然继续切换,但 applyModelSwitch 内部会捕获到没有 key
    }

    await this.applyProviderSwitch(pickedProvider.id);
    this.output.printSuccess(`provider 已切换为: ${pickedProvider.name} (${pickedProvider.id})`);

    // 自动跟进选模型
    this.session.addMessage(
      'system',
      `[system: provider switched to ${pickedProvider.id}. Picking a new model…]`,
    );
    await this.handleModelSwitch();
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

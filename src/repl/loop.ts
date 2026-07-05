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
import { REPLInput, type PromptResult } from './input.js';
import { REPLOutput } from './output.js';
import { AIEngine } from '../core/ai-engine.js';
import { SessionManager } from '../core/session.js';
import { ConfigManager } from '../core/config.js';
import { SystemPromptBuilder } from '../core/system-prompt.js';
import { getBuiltInTools } from '../tools/index.js';

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
      // 没有在生成:交给 REPLInput 处理(它会检测是否要退出)
      this.output.printWarning('\n(press Ctrl+C again on an empty prompt to exit)');
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
    const cmd = input.toLowerCase().trim();

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
      case 'providers':
        this.showProviders();
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
      const stream = (this.ai as any).chatStream(this.session.getMessages());
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
    this.output.printHeader('🌐 Available Providers');
    this.output.printInfo('  siliconflow  - 硅基流动 (default)');
    this.output.printInfo('  minimax     - MiniMax M2.5');
    this.output.printInfo('  openai      - OpenAI GPT');
    this.output.printInfo('  anthropic   - Anthropic Claude');
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

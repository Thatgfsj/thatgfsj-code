/**
 * REPL Output Handler
 * Handles streaming output, colors, and formatting
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';
import pkg from '../../package.json' with { type: 'json' };

const VERSION: string = pkg.version;

export class REPLOutput {
  private spinner: Ora | null = null;
  private isStreaming: boolean = false;
  
  // Color schemes
  readonly colors = {
    user: chalk.cyan,
    assistant: chalk.green,
    system: chalk.yellow,
    error: chalk.red,
    warning: chalk.yellow,
    info: chalk.gray,
    code: chalk.bgBlack,
    success: chalk.green,
    tool: chalk.magenta,
    diff: {
      add: chalk.green,
      remove: chalk.red,
      header: chalk.blue
    }
  };

  /**
   * Print user input
   */
  printUser(input: string): void {
    console.log(this.colors.user('\n👤 ') + input);
  }

  /**
   * Print assistant response
   */
  printAssistant(content: string): void {
    console.log(this.colors.assistant('\n🤖 ') + content);
  }

  /**
   * Print tool execution
   */
  printTool(name: string, result: string): void {
    console.log(this.colors.tool(`\n🔧 Tool: ${name}`));
    console.log(this.colors.info(result));
  }

  /**
   * Print error
   */
  printError(error: string): void {
    console.error(this.colors.error(`\n❌ Error: ${error}`));
  }

  /**
   * Print warning
   */
  printWarning(warning: string): void {
    console.warn(this.colors.warning(`\n⚠️  ${warning}`));
  }

  /**
   * Print success
   */
  printSuccess(message: string): void {
    console.log(this.colors.success(`\n✅ ${message}`));
  }

  /**
   * Print info
   */
  printInfo(message: string): void {
    console.log(this.colors.info(message));
  }

  /**
   * Print code block
   */
  printCode(code: string, language: string = ''): void {
    console.log(chalk.bgBlack.gray('```' + language));
    console.log(chalk.bgBlack(code));
    console.log(chalk.bgBlack.gray('```'));
  }

  /**
   * Start spinner
   */
  startSpinner(text: string): void {
    this.spinner = ora({
      text,
      color: 'cyan',
      spinner: 'dots'
    }).start();
  }

  /**
   * Update spinner text
   */
  updateSpinner(text: string): void {
    if (this.spinner) {
      this.spinner.text = text;
    }
  }

  /**
   * Stop spinner with success
   */
  stopSpinnerSuccess(text?: string): void {
    if (this.spinner) {
      this.spinner.succeed(text || this.spinner.text);
      this.spinner = null;
    }
  }

  /**
   * Stop spinner with error
   */
  stopSpinnerError(text?: string): void {
    if (this.spinner) {
      this.spinner.fail(text || this.spinner.text);
      this.spinner = null;
    }
  }

  /**
   * Stop spinner
   */
  stopSpinner(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  /**
   * Print divider
   */
  printDivider(char: string = '─', length: number = 40): void {
    console.log(chalk.gray(char.repeat(length)));
  }

  /**
   * Print header
   */
  printHeader(text: string): void {
    this.printDivider();
    console.log(chalk.cyan(text));
    this.printDivider();
  }

  /**
   * Print with typewriter effect (streaming)
   */
  async printTypewriter(text: string, delay: number = 20): Promise<void> {
    this.isStreaming = true;
    
    process.stdout.write(chalk.green('\n🤖 '));
    
    for (let i = 0; i < text.length; i++) {
      if (!this.isStreaming) {
        // User interrupted, print rest immediately
        process.stdout.write(text.slice(i));
        break;
      }
      process.stdout.write(text[i]);
      await new Promise(r => setTimeout(r, delay));
    }
    
    process.stdout.write('\n');
  }

  /**
   * Stop streaming (for Ctrl+C)
   */
  stopStreaming(): void {
    this.isStreaming = false;
  }

  /**
   * Clear screen
   */
  clear(): void {
    console.clear();
  }

  /**
   * Print banner
   */
  printBanner(): void {
    console.log(chalk.cyan(`
╔═══════════════════════════════════════╗
║     🤖 Thatgfsj Code v${VERSION.padEnd(11)}║
║     Claude Code Style REPL           ║
╚═══════════════════════════════════════╝
    `));
  }

  /**
   * Print help
   */
  printHelp(): void {
    console.log(`
${chalk.cyan('命令 / Commands:')}
  ${chalk.gray('/help  帮助  /退出')}                       - 显示帮助 show this help
  ${chalk.gray('/clear  清屏')}                            - 清屏 clear screen
  ${chalk.gray('/context  上下文')}                        - 显示项目上下文 context
  ${chalk.gray('/history  历史')}                          - 历史 history
  ${chalk.gray('/tools  工具')}                            - 列出工具 list tools
  ${chalk.gray('/models  模型列表 / /providers  提供商')}  - 只读列出 provider+model
  ${chalk.gray('/model   模型')}                           - 切换 / 管理模型(主视图:已保存的模型 + 添加入口)
  ${chalk.gray('/provider  提供商切换')}                   - 切换 provider,顺便跟到 /model
  ${chalk.gray('/edit  修改 / 编辑')}                      - 修改已保存模型的 ctx / thinking / note

${chalk.cyan('提示 / Tips:')}
  • ${chalk.gray('/模型 / /帮助 / /退出')} 等中文命令别名都已支持 — 中文别名直接生效
  • 用 ${chalk.gray('/退出 / exit')} 或 ${chalk.gray('Ctrl+C')} 退出 REPL
  • ${chalk.gray('↑/↓')} 翻历史 · ${chalk.gray('\\')} 多行输入
    `);
  }
}

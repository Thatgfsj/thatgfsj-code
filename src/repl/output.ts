/**
 * REPL Output Handler
 * Handles streaming output, colors, and formatting
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';

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
║     🤖 Thatgfsj Code v0.2.0        ║
║     Claude Code Style REPL           ║
╚═══════════════════════════════════════╝
    `));
  }

  /**
   * Print help
   */
  printHelp(): void {
    console.log(`
${chalk.cyan('Commands:')}
  ${chalk.gray('exit, Ctrl+C')}  - Exit the REPL
  ${chalk.gray('clear')}           - Clear screen
  ${chalk.gray('context')}          - Show project context
  ${chalk.gray('history')}          - Show command history
  ${chalk.gray('tools')}            - List available tools
  ${chalk.gray('help')}            - Show this help

${chalk.cyan('Tips:')}
  • Use ${chalk.gray('\\')} at end for multiline input
  • Use ${chalk.gray('↑/↓')} for command history
  • Use ${chalk.gray('Tab')} for auto-complete
    `);
  }
}

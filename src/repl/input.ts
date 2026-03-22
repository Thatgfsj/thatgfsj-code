/**
 * REPL Input Handler
 * Handles multiline input, history, and Ctrl+C
 */

import readline from 'readline';
import chalk from 'chalk';

export class REPLInput {
  private rl: readline.Interface;
  private history: string[] = [];
  private historyIndex: number = -1;
  private currentInput: string = '';
  private multilineMode: boolean = false;
  private multilineBuffer: string[] = [];

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: this.completer.bind(this),
      historySize: 100,
      tabSize: 4
    });

    // Handle Ctrl+C
    this.rl.on('SIGINT', () => {
      if (this.currentInput.length > 0 || this.multilineBuffer.length > 0) {
        // Clear current input
        this.currentInput = '';
        this.multilineBuffer = [];
        this.multilineMode = false;
        process.stdout.write('\n');
        this.rl.prompt();
      } else {
        // Exit REPL
        process.stdout.write(chalk.gray('\n\n👋 Exiting...\n'));
        process.exit(0);
      }
    });

    // Track history navigation
    this.rl.on('line', (line) => {
      if (line.trim()) {
        this.history.push(line);
        if (this.history.length > 100) {
          this.history.shift();
        }
      }
      this.historyIndex = this.history.length;
    });
  }

  /**
   * Prompt for input
   */
  async prompt(prefix: string = chalk.green('\n> ')): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prefix, (answer) => {
        resolve(answer);
      });
    });
  }

  /**
   * Set prompt prefix
   */
  setPrompt(prefix: string): void {
    this.rl.setPrompt(prefix);
  }

  /**
   * Close the interface
   */
  close(): void {
    this.rl.close();
  }

  /**
   * Pause input
   */
  pause(): void {
    this.rl.pause();
  }

  /**
   * Resume input
   */
  resume(): void {
    this.rl.resume();
  }

  /**
   * Get previous command from history (for key handler)
   */
  getPreviousHistory(): string | null {
    if (this.history.length === 0) return null;
    
    if (this.historyIndex > 0) {
      this.historyIndex--;
    }
    return this.history[this.historyIndex] || null;
  }

  /**
   * Get next command from history (for key handler)
   */
  getNextHistory(): string | null {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      return this.history[this.historyIndex];
    }
    this.historyIndex = this.history.length;
    return '';
  }

  /**
   * Reset history navigation
   */
  resetHistoryNavigation(): void {
    this.historyIndex = this.history.length;
  }

  /**
   * Simple completer for commands
   */
  private completer(line: string): [string[], string] {
    const commands = [
      'exit', 'quit', 'clear', 'context',
      'help', 'tools', 'models', 'providers',
      'history', 'git', 'file', 'shell'
    ];
    
    const hits = commands.filter(c => c.startsWith(line.toLowerCase()));
    return [hits.length ? hits : [], line];
  }

  /**
   * Handle multiline input detection
   */
  isMultilineComplete(input: string): boolean {
    // Check for explicit multiline trigger
    if (input.endsWith('\\')) {
      return false;
    }
    
    // Check bracket balance
    const openBrackets = (input.match(/\{/g) || []).length;
    const closeBrackets = (input.match(/\}/g) || []).length;
    const openParens = (input.match(/\(/g) || []).length;
    const closeParens = (input.match(/\)/g) || []).length;
    const openBrackets2 = (input.match(/\[/g) || []).length;
    const closeBrackets2 = (input.match(/\]/g) || []).length;
    
    // Balanced if all counts match
    return openBrackets === closeBrackets && 
           openParens === closeParens && 
           openBrackets2 === closeBrackets2;
  }
}

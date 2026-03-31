/**
 * REPL Loop
 * Main interactive loop with streaming support
 */

import chalk from 'chalk';
import { REPLInput } from './input.js';
import { REPLOutput } from './output.js';
import { AIEngine } from '../core/ai-engine.js';
import { SessionManager } from '../core/session.js';
import { ConfigManager } from '../core/config.js';
import { FileTool } from '../tools/file.js';
import { ShellTool } from '../tools/shell.js';
import { SystemPromptBuilder } from '../core/system-prompt.js';
import { getBuiltInTools } from '../tools/index.js';

export class REPLLoop {
  private input: REPLInput;
  private output: REPLOutput;
  private ai: AIEngine | null = null;
  private session: SessionManager | null = null;
  private running: boolean = false;

  constructor() {
    this.input = new REPLInput();
    this.output = new REPLOutput();
  }

  /**
   * Initialize the REPL
   * S04: Use SystemPromptBuilder for dynamic prompt construction
   */
  async init(): Promise<void> {
    // Load config
    const config = await ConfigManager.load();

    // Initialize AI engine
    this.ai = new AIEngine(config);

    // Register tools
    const builtInTools = getBuiltInTools();
    for (const tool of builtInTools) {
      this.ai!.registerTool(tool);
    }

    // Initialize session
    this.session = new SessionManager();

    // S04: Build system prompt dynamically from tools
    const promptBuilder = new SystemPromptBuilder({
      cwd: process.cwd(),
      tools: builtInTools,
      permissionMode: 'ask'
    });
    const systemPrompt = promptBuilder.build();

    this.session.addMessage('system', systemPrompt);

    this.running = true;
  }

  /**
   * Start the REPL loop
   */
  async start(): Promise<void> {
    await this.init();
    
    // Show banner
    this.output.clear();
    this.output.printBanner();
    this.output.printInfo('\nType "help" for available commands\n');
    this.output.printDivider();
    
    // Main loop
    while (this.running) {
      try {
        const userInput = await this.input.prompt();
        
        // Handle empty input
        if (!userInput) {
          continue;
        }
        
        // Handle special commands
        const handled = await this.handleCommand(userInput);
        if (handled) {
          continue;
        }
        
        // Process with AI
        await this.processInput(userInput);
        
      } catch (error: any) {
        if (error.message === 'SIGINT') {
          // User pressed Ctrl+C, continue
          continue;
        }
        this.output.printError(error.message);
      }
    }
  }

  /**
   * Handle built-in commands
   */
  private async handleCommand(input: string): Promise<boolean> {
    const cmd = input.toLowerCase().trim();
    
    switch (cmd) {
      case 'exit':
      case 'quit':
      case '\\x03': // Ctrl+C
        this.output.printInfo('\n👋 Goodbye!');
        this.running = false;
        this.input.close();
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
   * Process user input with AI (S03: streaming with permission check)
   */
  private async processInput(input: string): Promise<void> {
    if (!this.ai || !this.session) {
      this.output.printError('AI not initialized');
      return;
    }

    // Add user message
    this.session.addMessage('user', input);

    // Show thinking
    this.output.startSpinner('Thinking...');
    let fullResponse = '';

    try {
      // S01: Stream output via chatStream
      const stream = (this.ai as any).chatStream(this.session.getMessages());
      for await (const chunk of stream) {
        this.output.stopSpinner();
        process.stdout.write(chunk);
        fullResponse += chunk;
      }

      console.log();

      // Add assistant message
      this.session.addMessage('assistant', fullResponse);

      // Truncate if too long
      this.session.truncate(20);

    } catch (error: any) {
      this.output.stopSpinner();
      this.output.printError(error.message);
    }
  }

  /**
   * Show project context
   */
  private showContext(): void {
    const cwd = process.cwd();
    this.output.printHeader('📁 Project Context');
    this.output.printInfo(`Working directory: ${cwd}`);
    // TODO: Add more context (package.json, git status, etc.)
  }

  /**
   * Show command history
   */
  private showHistory(): void {
    this.output.printHeader('📜 Command History');
    // TODO: Implement history display
    this.output.printInfo('(History not yet implemented)');
  }

  /**
   * Show available tools
   */
  private showTools(): void {
    this.output.printHeader('🔧 Available Tools');
    this.output.printInfo('  file    - File operations (read, write, list, delete)');
    this.output.printInfo('  shell   - Execute shell commands');
    this.output.printInfo('  git     - Git operations (coming soon)');
  }

  /**
   * Show available providers
   */
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
    this.input.close();
    this.output.stopStreaming();
  }

  /**
   * Handle interrupt (Ctrl+C)
   */
  interrupt(): void {
    this.output.printWarning('\n\n⚠️  Interrupted');
    this.output.stopStreaming();
    this.output.printInfo('\nType "exit" to quit, or continue...\n');
  }
}

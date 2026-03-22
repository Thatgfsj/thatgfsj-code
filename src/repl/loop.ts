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
   */
  async init(): Promise<void> {
    // Load config
    const config = await ConfigManager.load();
    
    // Initialize AI engine
    this.ai = new AIEngine(config);
    
    // Register tools
    this.ai.registerTool(new ShellTool());
    this.ai.registerTool(new FileTool());
    
    // Initialize session
    this.session = new SessionManager();
    
    // Add system prompt
    const systemPrompt = `You are Thatgfsj Code, an AI coding assistant like Claude Code.
You can:
- Read, write, and edit files
- Execute shell commands
- Search and analyze code
- Use git for version control

When the user asks to do something:
1. Understand what they want
2. Use tools to complete the task
3. Explain what you did

Be concise, helpful, and show your reasoning.`;
    
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
   * Process user input with AI
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
    
    try {
      const response = await this.ai.chat(this.session.getMessages());
      
      this.output.stopSpinner();
      
      // Print response
      this.output.printAssistant(response.content);
      
      // Add assistant message
      this.session.addMessage('assistant', response.content);
      
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

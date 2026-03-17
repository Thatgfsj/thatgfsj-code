#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

import { AIEngine } from './core/ai-engine.js';
import { ToolRegistry } from './core/tool-registry.js';
import { SessionManager } from './core/session.js';
import { ConfigManager } from './core/config.js';
import { FileTool } from './tools/file.js';
import { ShellTool } from './tools/shell.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// CLI Program
program
  .name('thatgfsj')
  .description('Thatgfsj Code - Your AI Coding Assistant')
  .version('0.1.0');

program
  .command('chat')
  .description('Start interactive chat mode')
  .option('-s, --system <prompt>', 'System prompt')
  .action(async (options) => {
    await startChat(options.system);
  });

program
  .command('exec <prompt>')
  .description('Execute a single prompt')
  .option('-s, --stream', 'Stream output')
  .action(async (prompt, options) => {
    await executePrompt(prompt, options.stream);
  });

program
  .command('init')
  .description('Initialize Thatgfsj Code')
  .action(async () => {
    await initialize();
  });

program
  .command('config')
  .description('Show current configuration')
  .action(() => {
    showConfig();
  });

// Default: show help or start chat
program.parse(process.argv);

if (process.argv.length === 2) {
  console.log(chalk.cyan('Thatgfsj Code v0.1.0'));
  console.log(chalk.gray('Type "thatgfsj chat" to start interactive mode'));
  console.log(chalk.gray('Type "thatgfsj --help" for more info'));
}

// ============== Core Functions ==============

async function startChat(systemPrompt?: string) {
  console.log(chalk.cyan('\n🤖 Thatgfsj Code - Interactive Mode\n'));
  console.log(chalk.gray('Type "exit" to quit, "clear" to clear history\n'));

  const config = await ConfigManager.load();
  const ai = new AIEngine(config);
  const session = new SessionManager();
  
  // Add system prompt
  if (systemPrompt) {
    session.addMessage('system', systemPrompt);
  } else {
    session.addMessage('system', 'You are Thatgfsj Code, a helpful AI coding assistant.');
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const prompt = () => {
    rl.question(chalk.green('\n> '), async (input) => {
      const trimmed = input.trim();
      
      if (trimmed === 'exit' || trimmed === 'quit') {
        console.log(chalk.gray('\nGoodbye! 👋'));
        rl.close();
        return;
      }
      
      if (trimmed === 'clear') {
        session.clear();
        console.log(chalk.gray('History cleared.'));
        prompt();
        return;
      }
      
      if (!trimmed) {
        prompt();
        return;
      }

      // Add user message
      session.addMessage('user', trimmed);

      // Show thinking indicator
      const spinner = ora('Thinking...').start();

      try {
        const response = await ai.chat(session.getMessages());
        spinner.stop();
        
        // Display response
        console.log(chalk.cyan('\n🤖:'), response.content);
        
        // Add assistant message
        session.addMessage('assistant', response.content);
        
      } catch (error: any) {
        spinner.fail(chalk.red(`Error: ${error.message}`));
      }

      prompt();
    });
  };

  prompt();
}

async function executePrompt(prompt: string, stream?: boolean) {
  const spinner = ora('Executing...').start();
  
  try {
    const config = await ConfigManager.load();
    const ai = new AIEngine(config);
    const session = new SessionManager();
    
    session.addMessage('user', prompt);
    
    const response = await ai.chat(session.getMessages());
    spinner.stop();
    
    console.log(chalk.cyan('\n🤖:'), response.content);
    
  } catch (error: any) {
    spinner.fail(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

async function initialize() {
  console.log(chalk.cyan('\n🚀 Initializing Thatgfsj Code...\n'));
  
  const configDir = join(process.env.HOME || process.env.USERPROFILE || '', '.thatgfsj');
  const configFile = join(configDir, 'config.json');
  
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  
  // Create default config
  const defaultConfig = {
    model: 'minimax/MiniMax-M2.5',
    apiKey: process.env.OPENAI_API_KEY || '',
    temperature: 0.7,
    maxTokens: 4096
  };
  
  const { writeFileSync } = await import('fs');
  writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2));
  
  console.log(chalk.green('✅ Initialized successfully!'));
  console.log(chalk.gray(`Config saved to: ${configFile}`));
  console.log(chalk.gray('\nPlease set your API key:'));
  console.log(chalk.gray('  export OPENAI_API_KEY=your_key'));
  console.log(chalk.gray('  or edit the config file\n'));
}

function showConfig() {
  console.log(chalk.cyan('\n⚙️  Current Configuration\n'));
  console.log(chalk.gray('Config file: ~/.thatgfsj/config.json'));
  console.log(chalk.gray('API Key: Set via OPENAI_API_KEY env var'));
  console.log(chalk.gray('Model: minimax/MiniMax-M2.5 (default)\n'));
}

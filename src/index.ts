#!/usr/bin/env node

/**
 * Thatgfsj Code - AI Coding Assistant
 * Claude Code-like interactive CLI
 */

// 强制 UTF-8 编码 (Windows) - 必须在任何输出之前
if (process.platform === 'win32') {
  try {
    // 执行 chcp 65001 设置代码页
    require('child_process').execSync('chcp 65001', { stdio: 'ignore', windowsHide: true });
  } catch {}
}

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'fs';

import { AIEngine } from './core/ai-engine.js';
import { ToolRegistry } from './core/tool-registry.js';
import { SessionManager } from './core/session.js';
import { ConfigManager } from './core/config.js';
import { FileTool, ShellTool, GitTool, SearchTool } from './tools/index.js';
import { WelcomeScreen } from './repl/welcome.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============== Global Error Handling ==============

process.on('uncaughtException', (error) => {
  console.error(chalk.red('\n❌ Error:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('\n❌ Error:'), reason);
  process.exit(1);
});

// ============== CLI Program ==============

// Add init command
program
  .command('init')
  .description('初始化配置/设置向导')
  .action(async () => {
    const { WelcomeScreen } = await import('./repl/welcome.js');
    await WelcomeScreen.interactiveSetup();
  });

// Add explain command
program
  .command('explain')
  .description('解释代码含义 (Explain code in plain language)')
  .argument('[file or code]', '要解释的代码或文件路径')
  .option('-f, --file <path>', '从文件读取代码')
  .action(async (code, options) => {
    await executeExplain(code, options);
  });

// Add debug command
program
  .command('debug')
  .description('Debug 代码问题 (Find and fix bugs)')
  .argument('[file or code]', '需要调试的代码或文件路径')
  .option('-f, --file <path>', '从文件读取代码')
  .option('-e, --error <message>', '附加的错误信息')
  .action(async (code, options) => {
    await executeDebug(code, options);
  });

// Add chat command (simple Q&A)
program
  .command('chat')
  .description('与 AI 问答 (Simple Q&A about your project)')
  .argument('[question]', '问题')
  .action(async (question) => {
    await executeChat(question);
  });

// Add template command
program
  .command('template')
  .description('代码模板生成 (Generate common code templates)')
  .argument('[type]', '模板类型: react, vue, express, python-script, api-client, etc.')
  .option('-n, --name <name>', '项目/组件名称')
  .option('-o, --output <dir>', '输出目录')
  .action(async (type, options) => {
    await executeTemplate(type, options);
  });

program
  .name('gfcode')
  .description('🤖 AI Coding Assistant - Like Claude Code')
  .version('0.2.0')
  .argument('[prompt]', 'Task to execute (omit to start interactive mode)')
  .option('-i, --interactive', 'Start interactive mode')
  .option('-s, --stream', 'Stream output')
  .option('-m, --model <model>', 'Specify model')
  .option('--no-auto', 'Disable auto-read project files')
  .action(async (prompt, options) => {
    // Check for API key and show welcome if needed
    const { WelcomeScreen } = await import('./repl/welcome.js');
    const hasApiKey = checkApiKey();
    
    if (!hasApiKey) {
      WelcomeScreen.show();
    }
    
    // Default to interactive mode if no prompt provided
    if (!prompt && !options.interactive) {
      await startInteractive();
    } else if (prompt) {
      await executeTask(prompt, options);
    } else {
      await startInteractive();
    }
  });

// Helper to check API key
function checkApiKey(): boolean {
  return !!(process.env.SILICONFLOW_API_KEY || 
            process.env.OPENAI_API_KEY || 
            process.env.MINIMAX_API_KEY ||
            process.env.ANTHROPIC_API_KEY ||
            process.env.GEMINI_API_KEY ||
            process.env.KIMI_API_KEY ||
            process.env.MOONSHOT_API_KEY ||
            process.env.DEEPSEEK_API_KEY ||
            process.env.OLLAMA_BASE_URL);
}

// Parse
program.parse(process.argv);

// ============== Core Functions ==============

/**
 * Get project context
 */
function getProjectContext(): string {
  const cwd = process.cwd();
  const info: string[] = [];
  
  try {
    // Package info
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      info.push(`📦 Project: ${cwd}`);
      const { readFileSync } = require('fs');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      info.push(`   Name: ${pkg.name || 'unknown'}`);
      if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
        info.push(`   Deps: ${Object.keys(pkg.dependencies).length} packages`);
      }
    } else {
      info.push(`📁 Working dir: ${cwd}`);
    }
    
    // Count files
    let fileCount = 0;
    const countFiles = (dir: string) => {
      try {
        const items = readdirSync(dir);
        for (const item of items) {
          if (item === 'node_modules' || item === '.git') continue;
          const fullPath = join(dir, item);
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            countFiles(fullPath);
          } else if (/\.(ts|js|py|go|rs|java|cpp|c|h)$/.test(item)) {
            fileCount++;
          }
        }
      } catch {}
    };
    countFiles(cwd);
    if (fileCount > 0) {
      info.push(`   Files: ${fileCount} code files`);
    }
  } catch {}
  
  return info.join('\n');
}

/**
 * Execute a task (Claude Code style)
 */
async function executeTask(prompt: string, options: any) {
  console.log(chalk.cyan('\n🤖 Thatgfsj Code\n'));
  console.log(chalk.gray(getProjectContext()));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(chalk.cyan('\n> ') + prompt + '\n');
  
  try {
    const config = await ConfigManager.load();
    if (options.model) config.model = options.model;
    
    const ai = new AIEngine(config);
    const session = new SessionManager();
    const registry = new ToolRegistry();
    
    // Register tools - all available tools
    const shellTool = new ShellTool();
    const fileTool = new FileTool();
    const gitTool = new GitTool();
    const searchTool = new SearchTool();
    
    ai.registerTool(shellTool);
    ai.registerTool(fileTool);
    ai.registerTool(gitTool);
    ai.registerTool(searchTool);
    
    // System prompt - Claude Code style
    const systemPrompt = `You are Thatgfsj Code, an AI coding assistant like Claude Code.
You can read files, write files, and execute shell commands to complete coding tasks.

When working on a task:
1. First understand what files are involved
2. Read necessary files to understand the codebase  
3. Make changes
4. Verify the changes work

Be concise but thorough. Show your reasoning.`;
    
    session.addMessage('system', systemPrompt);
    session.addMessage('user', prompt);
    
    const spinner = ora(chalk.gray('Thinking...')).start();
    let fullResponse = '';
    
    for await (const chunk of ai.chatStream(session.getMessages())) {
      spinner.stop();
      process.stdout.write(chunk);
      fullResponse += chunk;
    }
    
    console.log(chalk.gray('\n' + '─'.repeat(40)));
    
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Handle model switch in interactive mode
 */
async function handleModelSwitch(rl: readline.Interface, currentConfig: any) {
  console.log(chalk.cyan('\n切换模型...\n'));
  
  // Get available models based on current provider
  const models = WelcomeScreen.getModelsForProvider(currentConfig.provider || 'siliconflow');
  
  console.log(chalk.gray('可用模型:\n'));
  models.forEach((model, idx) => {
    const selected = model.id === currentConfig.model ? ' ✓' : '';
    console.log(chalk.gray(`  ${idx + 1}. ${model.name} - ${model.desc}${selected}`));
  });
  
  console.log();
  
  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.green('选择模型编号: '), resolve);
  });
  
  const idx = parseInt(answer) - 1;
  if (idx >= 0 && idx < models.length) {
    const selected = models[idx];
    
    // Save to config
    const config = { ...currentConfig, model: selected.id };
    const configPath = join(homedir(), '.thatgfsj', 'config.json');
    
    try {
      const dir = join(homedir(), '.thatgfsj');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(chalk.green(`\n✓ 模型已切换为: ${selected.name}\n`));
    } catch (e: any) {
      console.error(chalk.red(`\n保存失败: ${e.message}\n`));
    }
  } else {
    console.log(chalk.yellow('\n无效选择，保持当前模型\n'));
  }
}

/**
 * Start interactive mode (Claude Code style)
 */
async function startInteractive() {
  console.log(chalk.cyan('\n🤖 Thatgfsj Code - Interactive Mode\n'));
  console.log(chalk.gray(getProjectContext()));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(chalk.gray('\nCommands:'));
  console.log(chalk.gray('  exit, Ctrl+C   - Quit'));
  console.log(chalk.gray('  clear          - Clear history'));
  console.log(chalk.gray('  context        - Show project context'));
  console.log(chalk.gray('\n' + '─'.repeat(40) + '\n'));
  
  try {
    const config = await ConfigManager.load();
    const ai = new AIEngine(config);
    const session = new SessionManager();
    
    // Register tools - all available tools
    const shellTool = new ShellTool();
    const fileTool = new FileTool();
    const gitTool = new GitTool();
    const searchTool = new SearchTool();
    
    ai.registerTool(shellTool);
    ai.registerTool(fileTool);
    ai.registerTool(gitTool);
    ai.registerTool(searchTool);
    
    // System prompt
    const defaultSystem = `You are Thatgfsj Code, an AI coding assistant like Claude Code.
You can read files, write files, and execute shell commands.
Be helpful, concise, and show your reasoning.`;
    session.addMessage('system', defaultSystem);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });

    const ask = () => {
      rl.question(chalk.green('\n> '), async (input) => {
        const trimmed = input.trim();
        
        if (!trimmed) {
          ask();
          return;
        }
        
        // Commands
        if (trimmed === 'exit' || trimmed === 'quit' || trimmed === '\\x03') {
          console.log(chalk.gray('\n👋 Goodbye!'));
          rl.close();
          return;
        }
        
        if (trimmed === 'clear') {
          session.clear();
          console.clear();
          console.log(chalk.cyan('🤖 Thatgfsj Code - Interactive Mode\n'));
          ask();
          return;
        }
        
        if (trimmed === 'context') {
          console.log(chalk.cyan('\n' + getProjectContext() + '\n'));
          ask();
          return;
        }
        
        // Model switch command
        if (trimmed === '/model' || trimmed === 'model') {
          await handleModelSwitch(rl, config);
          ask();
          return;
        }

        // Add and process with streaming
        session.addMessage('user', trimmed);
        
        const spinner = ora(chalk.gray('Thinking...')).start();
        let fullResponse = '';
        
        try {
          // S01: Use async generator for true streaming
          for await (const chunk of ai.chatStream(session.getMessages())) {
            spinner.stop();
            process.stdout.write(chunk);
            fullResponse += chunk;
          }
          
          console.log(); // newline after streaming
          
          session.addMessage('assistant', fullResponse);
          session.truncate(20);
          
        } catch (error: any) {
          spinner.fail(chalk.red(`Error: ${error.message}`));
        }

        ask();
      });
    };

    ask();
    
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Failed to start: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Execute explain command - explain code in plain language
 */
async function executeExplain(code: string, options: any): Promise<void> {
  let codeContent = code;
  
  // Read from file if specified
  if (options.file) {
    try {
      const { readFileSync } = await import('fs');
      codeContent = readFileSync(options.file, 'utf-8');
      console.log(chalk.gray(`📄 Reading from: ${options.file}\n`));
    } catch (error: any) {
      console.error(chalk.red(`❌ 无法读取文件: ${error.message}`));
      process.exit(1);
    }
  }
  
  if (!codeContent) {
    console.error(chalk.red('❌ 请提供要解释的代码或使用 -f <file> 指定文件'));
    console.log(chalk.gray('用法: gfcode explain "代码" 或 gfcode explain -f path/to/file'));
    process.exit(1);
  }
  
  console.log(chalk.cyan('\n📖 Thatgfsj Code - 代码解释\n'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(chalk.gray('\n📝 要解释的代码:\n'));
  console.log(chalk.white(codeContent.slice(0, 500) + (codeContent.length > 500 ? '...' : '')));
  console.log(chalk.gray('\n' + '─'.repeat(40)));
  
  try {
    const config = await ConfigManager.load();
    const ai = new AIEngine(config);
    
    const prompt = `请用通俗易懂的语言解释以下代码的功能和工作原理。
如果代码有问题或可以优化，也请指出。

\`\`\`
${codeContent}
\`\`\`

请用中文回复，解释要清晰详细，适合编程新手理解。`;
    
    const spinner = ora(chalk.gray('AI 正在分析代码...')).start();
    const response = await ai.chat([
      { role: 'system', content: '你是一个耐心的编程老师，善于用通俗易懂的语言解释代码。' },
      { role: 'user', content: prompt }
    ]);
    spinner.stop();
    
    console.log(chalk.cyan('\n💡 解释结果:\n'));
    console.log(chalk.white(response.content));
    
  } catch (error: any) {
    console.error(chalk.red(`\n❌ 解释失败: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Execute debug command - find and fix bugs
 */
async function executeDebug(code: string, options: any): Promise<void> {
  let codeContent = code;
  
  // Read from file if specified
  if (options.file) {
    try {
      const { readFileSync } = await import('fs');
      codeContent = readFileSync(options.file, 'utf-8');
      console.log(chalk.gray(`📄 Reading from: ${options.file}\n`));
    } catch (error: any) {
      console.error(chalk.red(`❌ 无法读取文件: ${error.message}`));
      process.exit(1);
    }
  }
  
  if (!codeContent) {
    console.error(chalk.red('❌ 请提供要调试的代码或使用 -f <file> 指定文件'));
    console.log(chalk.gray('用法: gfcode debug "代码" 或 gfcode debug -f path/to/file'));
    process.exit(1);
  }
  
  console.log(chalk.cyan('\n🔧 Thatgfsj Code - 代码调试\n'));
  console.log(chalk.gray('─'.repeat(40)));
  
  if (options.error) {
    console.log(chalk.yellow('\n⚠️  附加的错误信息:'));
    console.log(chalk.red(options.error));
  }
  
  console.log(chalk.gray('\n📝 待调试的代码:\n'));
  console.log(chalk.white(codeContent.slice(0, 500) + (codeContent.length > 500 ? '...' : '')));
  console.log(chalk.gray('\n' + '─'.repeat(40)));
  
  try {
    const config = await ConfigManager.load();
    const ai = new AIEngine(config);
    
    const errorInfo = options.error ? `\n附加的错误信息: ${options.error}` : '';
    const prompt = `请分析以下代码，找出潜在的问题和 bug，并给出修复建议。

\`\`\`
${codeContent}
\`\`\`
${errorInfo}

请用中文回复，包括:
1. 发现的问题列表
2. 问题的原因分析
3. 修复后的代码
4. 预防此类问题的建议`;

    const spinner = ora(chalk.gray('AI 正在分析代码...')).start();
    const response = await ai.chat([
      { role: 'system', content: '你是一个专业的代码调试专家，善于找出 bug 并提供修复方案。' },
      { role: 'user', content: prompt }
    ]);
    spinner.stop();
    
    console.log(chalk.cyan('\n🔍 调试结果:\n'));
    console.log(chalk.white(response.content));
    
  } catch (error: any) {
    console.error(chalk.red(`\n❌ 调试失败: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Execute chat command - simple Q&A about the project
 */
async function executeChat(question: string): Promise<void> {
  if (!question) {
    console.error(chalk.red('❌ 请提供问题'));
    console.log(chalk.gray('用法: gfcode chat "你的问题"'));
    process.exit(1);
  }
  
  console.log(chalk.cyan('\n💬 Thatgfsj Code - 问答\n'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(chalk.cyan('\n❓ 问题: ') + question + '\n');
  
  try {
    const config = await ConfigManager.load();
    const ai = new AIEngine(config);
    
    // Get project context
    const context = getProjectContext();
    
    const prompt = `你是一个专业的编程助手。请回答用户的问题。

项目上下文:
${context}

用户问题: ${question}

请用中文回答，如果涉及到代码，请给出完整的代码示例。`;

    const spinner = ora(chalk.gray('AI 正在思考...')).start();
    const response = await ai.chat([
      { role: 'system', content: '你是一个专业、友好的编程助手，善于用通俗易懂的语言回答问题。' },
      { role: 'user', content: prompt }
    ]);
    spinner.stop();
    
    console.log(chalk.cyan('\n💡 回答:\n'));
    console.log(chalk.white(response.content));
    
  } catch (error: any) {
    console.error(chalk.red(`\n❌ 问答失败: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Execute template command - generate code templates
 */
async function executeTemplate(type: string, options: any): Promise<void> {
  if (!type) {
    console.error(chalk.red('❌ 请指定模板类型'));
    console.log(chalk.gray('\n可用模板类型:'));
    console.log(chalk.gray('  react        - React 组件'));
    console.log(chalk.gray('  vue          - Vue 3 组件'));
    console.log(chalk.gray('  express      - Express API'));
    console.log(chalk.gray('  python       - Python 脚本'));
    console.log(chalk.gray('  api-client   - API 客户端'));
    console.log(chalk.gray('  component    - 通用组件'));
    console.log(chalk.gray('\n用法: gfcode template react -n MyComponent'));
    process.exit(1);
  }
  
  const name = options.name || 'MyProject';
  const output = options.output || '.';
  
  console.log(chalk.cyan('\n📦 Thatgfsj Code - 代码模板\n'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(chalk.gray(`模板类型: ${type}`));
  console.log(chalk.gray(`项目名称: ${name}`));
  console.log(chalk.gray(`输出目录: ${output}\n`));
  
  try {
    const config = await ConfigManager.load();
    const ai = new AIEngine(config);
    
    const templates: Record<string, string> = {
      'react': 'React 组件 (TypeScript)',
      'vue': 'Vue 3 组件 (TypeScript)',
      'express': 'Express API 路由',
      'python': 'Python 脚本',
      'api-client': 'API 客户端封装',
      'component': '通用前端组件'
    };
    
    const templateDesc = templates[type] || type;
    
    const prompt = `请生成一个 ${templateDesc} 的代码模板。

要求:
1. 代码要完整、可运行
2. 使用现代最佳实践
3. 包含适当的注释
4. 项目名称: ${name}

请只返回代码，不要解释。如果需要多个文件，请用 ---FILE:filename--- 分隔。`;

    const spinner = ora(chalk.gray('AI 正在生成模板...')).start();
    const response = await ai.chat([
      { role: 'system', content: '你是一个代码生成专家，擅长生成高质量、可运行的代码模板。' },
      { role: 'user', content: prompt }
    ]);
    spinner.stop();
    
    console.log(chalk.cyan('\n📄 生成的代码:\n'));
    console.log(chalk.white(response.content));
    
    // Ask if user wants to save
    console.log(chalk.gray('\n' + '─'.repeat(40)));
    console.log(chalk.gray('\n💡 要保存到文件吗? (y/n): '));
    
  } catch (error: any) {
    console.error(chalk.red(`\n❌ 模板生成失败: ${error.message}`));
    process.exit(1);
  }
}

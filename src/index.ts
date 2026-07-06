#!/usr/bin/env node

/**
 * Thatgfsj Code - AI Coding Assistant
 * Claude Code-like interactive CLI
 */

// 强制 UTF-8 编码 (Windows)。
// 注意:此项目是 ESM（package.json "type":"module"），绝不能在源码里直接
// 调用顶层 `require()`，否则会在所有平台上抛 ReferenceError。Windows 上
// 需要用 `createRequire(import.meta.url)` 才能拿到 CJS 风格的 `require`。
//
// 2.1.2 — chcp 65001 改为异步 fire-and-forget。原先的 `execSync` 会阻塞
// 主进程 60-80ms (实测),变成 chcp 还没返回就开始打印 banner,看起来很慢。
// 现代 Windows 终端 (Win10 1903+) 默认已经是 UTF-8,所以这一步只是一个
// 兼容性兜底,允许延后。我们用 setImmediate 立即开始 banner 的打印。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

if (process.platform === 'win32') {
  // Fire-and-forget — don't block the banner.
  setImmediate(() => {
    try {
      require('child_process').exec('chcp 65001 >NUL 2>&1', { windowsHide: true });
    } catch {}
  });
}

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  existsSync, mkdirSync, writeFileSync,
  readFileSync
} from 'fs';

// package.json 信息:便于把版本号与 README/CHANGELOG 保持同步
import pkg from '../package.json' with { type: 'json' };

import { AIEngine } from './core/ai-engine.js';
import { SessionManager } from './core/session.js';
import { ConfigManager } from './core/config.js';
// 2.1.2 — FileTool/ShellTool/GitTool/SearchTool/WelcomeScreen/REPLLoop
// 现在改为按需动态 import。`node dist/index.js` 启动时只需要 commander + chalk
// + ora + AIEngine + SessionManager + ConfigManager。这些是
// `node dist/index.js -i` (REPL 模式) 必备的最小集。
const fileURLEP = import.meta.url;
async function lazyLoadTools() {
  const [{ FileTool, ShellTool, GitTool, SearchTool }, { REPLLoop }, { WelcomeScreen }] = await Promise.all([
    import('./tools/index.js'),
    import('./repl/loop.js'),
    import('./repl/welcome.js'),
  ]);
  return { FileTool, ShellTool, GitTool, SearchTool, REPLLoop, WelcomeScreen };
}

const __filename = fileURLToPath(fileURLEP);
const __dirname = dirname(__filename);
const VERSION: string = pkg.version;

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
    const { WelcomeScreen } = await lazyLoadTools();
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
  .version(VERSION)
  .argument('[prompt]', 'Task to execute (omit to start interactive mode)')
  .option('-i, --interactive', 'Start interactive mode')
  .option('-s, --stream', 'Stream output')
  .option('-m, --model <model>', 'Specify model')
  .option('--no-auto', 'Disable auto-read project files')
  .action(async (prompt, options) => {
    // Check for API key and show welcome if needed
    const hasApiKey = checkApiKey();
    const { WelcomeScreen, REPLLoop } = await lazyLoadTools();

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
    // Package info (one read of cwd/package.json — cheap, sync is fine).
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      info.push(`📦 Project: ${cwd}`);
      const userPkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      info.push(`   Name: ${userPkg.name || 'unknown'}`);
      if (userPkg.dependencies && Object.keys(userPkg.dependencies).length > 0) {
        info.push(`   Deps: ${Object.keys(userPkg.dependencies).length} packages`);
      }
      // 2.1.2: 不再递归遍历 cwd 数所有 .ts/.js/.py 等源文件。Big projects
      // 里的 node_modules / monorepo 会让 readdirSync 在启动时阻塞 100-300ms,
      // 是启动"感觉慢"的最大可控项之一。如果用户真的关心文件数,可以用
      // `git ls-files | wc -l` 替代,而不是阻塞 REPL bootstrap。
    } else {
      info.push(`📁 Working dir: ${cwd}`);
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

    // Register tools - all available tools. Lazy-loaded so startup cold path
    // doesn't pay for them unless executeTask actually runs.
    const { ShellTool: _ST, FileTool: _FT, GitTool: _GT, SearchTool: _XT } = await import('./tools/index.js');
    const shellTool = new _ST();
    const fileTool = new _FT();
    const gitTool = new _GT();
    const searchTool = new _XT();

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

    // 把助手回复写回会话,便于后续轮次保留上下文
    session.addMessage('assistant', fullResponse);

  } catch (error: any) {
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Start interactive mode (Claude Code style)
 *
 * 委托给 REPLLoop,它使用 @inquirer/input,支持方向键(含数字小键盘)、行内
 * 编辑、命令历史、可滚动流式输出。原生 readline 在 Windows 终端下对小键盘
 * 方向键的 ANSI 转义序列不友好 (Bug #1),所以这里不再直接用 readline。
 */
async function startInteractive() {
  console.log(chalk.cyan('\n🤖 Thatgfsj Code - Interactive Mode\n'));
  console.log(chalk.gray(getProjectContext()));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(chalk.gray('\nCommands:'));
  console.log(chalk.gray('  exit, Ctrl+C   - Quit'));
  console.log(chalk.gray('  clear          - Clear screen'));
  console.log(chalk.gray('  context        - Show project context'));
  console.log(chalk.gray('  history        - Show command history'));
  console.log(chalk.gray('  help           - Show all commands'));
  console.log(chalk.gray('\n' + '─'.repeat(40) + '\n'));

  try {
    const { REPLLoop } = await lazyLoadTools();
    const repl = new REPLLoop();
    await repl.start();
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

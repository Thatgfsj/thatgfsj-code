/**
 * S12: CLI & Architecture
 * 
 * Main entry point, CLI argument parsing, and module architecture overview.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { AIEngine } from './ai-engine.js';
import { ConfigManager } from './config.js';
import { REPLLoop } from '../repl/loop.js';
import { ToolRegistry } from './tool-registry.js';
import { ShellTool, FileTool, GitTool } from '../tools/index.js';
import { HookManager, auditLogHook, getHookManager } from './hooks.js';
import { getStateManager } from './state.js';
import { SystemPromptBuilder } from './system-prompt.js';
import { BUILT_IN_SKILLS } from './skills.js';

// ==================== CLI Argument Parsing ====================

export interface CLIOptions {
  model?: string;
  provider?: string;
  prompt?: string;
  noStream?: boolean;
  verbose?: boolean;
  hooks?: boolean;
  permissionMode?: 'accept' | 'deny' | 'ask';
}

export function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--model':
      case '-m':
        options.model = args[++i];
        break;
      case '--provider':
      case '-p':
        options.provider = args[++i];
        break;
      case '--prompt':
      case '-c':
        options.prompt = args[++i];
        break;
      case '--no-stream':
        options.noStream = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--hooks':
        options.hooks = true;
        break;
      case '--permission':
        options.permissionMode = (args[++i] as 'accept' | 'deny' | 'ask') || 'ask';
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Thatgfsj Code - AI Coding Assistant

Usage: thatgfsj [options]

Options:
  -m, --model <model>       Set AI model
  -p, --provider <provider> Set provider (siliconflow, minimax, openai, etc.)
  -c, --prompt <text>       Run single prompt and exit
  --no-stream               Disable streaming output
  --hooks                   Enable built-in hooks (audit log, etc.)
  --permission <mode>       Set permission mode (accept, deny, ask)
  -v, --verbose             Verbose output
  -h, --help                Show this help

Examples:
  thatgfsj                           Start REPL
  thatgfsj -c "Hello"                Run single prompt
  thatgfsj --provider minimax --model MiniMax-M2.5  Use specific provider
  thatgfsj --permission accept        Accept all tool calls
`);
}

// ==================== Architecture ====================

/**
 * S12: Print architecture overview
 */
export function printArchitecture(): void {
  console.log(`
Thatgfsj Code Architecture
============================

Core:
  AIEngine         - Async generator agent loop (S01), multi-provider
  ToolRegistry     - Tool registration and execution (S02)
  PermissionChecker - 6-stage permission pipeline (S03)
  SystemPromptBuilder - Dynamic prompt construction (S04)
  ContextCompactor - 3-tier context compression (S05)
  SubagentManager  - Parallel subagent execution (S06)
  HookManager      - Event-driven hooks (S08)
  SkillsLoader     - Skills discovery and catalog (S10)
  StateManager     - Ephemeral/Persistent/Session state (S11)

Tools:
  ShellTool        - Shell command execution
  FileTool         - File read/write/list/delete
  GitTool          - Git operations

Entry:
  REPLLoop         - Interactive REPL
  CLI              - Command-line mode
`);
}

// ==================== Main ====================

export async function main(argv: string[]): Promise<void> {
  const options = parseArgs(argv.slice(2));

  // Single prompt mode
  if (options.prompt) {
    const config = await ConfigManager.load();
    if (options.provider) config.provider = options.provider as any;
    if (options.model) config.model = options.model;

    const ai = new AIEngine(config);
    const tools = [new ShellTool(), new FileTool(), new GitTool()];
    for (const tool of tools) ai.registerTool(tool);

    if (options.hooks) {
      const hooks = getHookManager();
      hooks.register('afterToolCall', auditLogHook);
      ai.setHooks(hooks);
    }

    const promptBuilder = new SystemPromptBuilder({ tools, permissionMode: options.permissionMode });
    const messages = [
      { role: 'system' as const, content: promptBuilder.build() },
      { role: 'user' as const, content: options.prompt }
    ];

    if (options.noStream) {
      const response = await ai.chat(messages);
      console.log(response.content);
    } else {
      for await (const chunk of ai.chatStream(messages)) {
        process.stdout.write(chunk);
      }
      console.log();
    }
    return;
  }

  // REPL mode
  const repl = new REPLLoop();
  await repl.start();
}

/**
 * S04: System Prompt Builder
 * Dynamic system prompt construction - not a static string, but a program
 * that assembles context from multiple sources each turn
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Tool } from './types.js';

export interface SystemPromptConfig {
  cwd?: string;
  tools?: Tool[];
  includeClaudeMd?: boolean;
  projectInstructions?: string;
  permissionMode?: 'accept' | 'deny' | 'ask';
  date?: Date;
  model?: string;
}

/**
 * S04: System Prompt Builder - assembles prompt from multiple fragments
 */
export class SystemPromptBuilder {
  private config: SystemPromptConfig;

  constructor(config: SystemPromptConfig = {}) {
    this.config = {
      cwd: process.cwd(),
      tools: [],
      includeClaudeMd: true,
      permissionMode: 'ask',
      date: new Date(),
      model: 'unknown',
      ...config
    };
  }

  build(): string {
    const fragments: string[] = [];
    fragments.push(this.buildIdentity());
    fragments.push(this.buildToolInstructions());
    fragments.push(this.buildEnvironment());
    fragments.push(this.buildPermissionMode());
    fragments.push(this.buildProjectInstructions());
    fragments.push(this.buildDateInfo());
    fragments.push(this.buildOutputFormat());
    return fragments.filter(Boolean).join('\n\n');
  }

  private buildIdentity(): string {
    return [
      'You are Thatgfsj Code, an AI coding assistant.',
      '',
      'You have access to tools (file operations, shell commands, git, search) that let you',
      'read, write, and modify files and run commands.',
      '',
      'Be concise, helpful, and show your reasoning when working through problems.',
      '',
      'When using tools:',
      '- Prefer small, targeted operations over large batch changes',
      '- Confirm destructive operations (rm, git push --force, etc.)',
      '- Explain what you are going to do before doing it',
      '- If something is not clear, ask clarifying questions'
    ].join('\n');
  }

  private buildToolInstructions(): string {
    const tools = this.config.tools || [];
    if (tools.length === 0) {
      return '## Tools\n\nNo tools are currently registered.';
    }

    const toolDescs = tools.map(t => {
      const params = t.parameters
        .map(p => '  - ' + p.name + ' (' + p.type + (p.required ? ', required' : '') + '): ' + p.description)
        .join('\n');
      return '### ' + t.name + '\n' + t.description + '\n\nParameters:\n' + params;
    }).join('\n\n');

    return '## Tools\n\nYou have access to the following tools:\n\n' + toolDescs + '\n\nTo use a tool, respond with a tool call. Each tool call must include:\n- The tool name\n- Parameters as a JSON object';
  }

  private buildEnvironment(): string {
    const cwd = this.config.cwd || process.cwd();
    return '## Environment\n\nWorking directory: ' + cwd;
  }

  private buildPermissionMode(): string {
    const mode = this.config.permissionMode || 'ask';
    const explanations: Record<string, string> = {
      accept: 'All tool calls are automatically allowed without confirmation.',
      deny: 'All tool calls are blocked. You may only read and discuss.',
      ask: 'Dangerous or destructive commands require your confirmation before execution.'
    };
    return '## Permission Mode\n\nCurrent mode: ' + mode + '\n\n' + (explanations[mode] || '');
  }

  private buildProjectInstructions(): string {
    const cwd = this.config.cwd || process.cwd();
    if (this.config.includeClaudeMd !== false) {
      const paths = [join(cwd, 'CLAUDE.md'), join(cwd, '.claude.md')];
      for (const path of paths) {
        if (existsSync(path)) {
          try {
            const content = readFileSync(path, 'utf-8');
            return '## Project Instructions (from ' + path.split(/[/\\]/).pop() + ')\n\n' + content;
          } catch {
            // Ignore
          }
        }
      }
    }
    if (this.config.projectInstructions) {
      return '## Project Instructions\n\n' + this.config.projectInstructions;
    }
    return '';
  }

  private buildDateInfo(): string {
    const now = this.config.date || new Date();
    const iso = now.toISOString().replace('T', ' ').split('.')[0];
    return '## Current Time\n\n' + iso;
  }

  private buildOutputFormat(): string {
    return [
      '## Output Format',
      '',
      '- Use clear section headers for multi-part responses',
      '- Use bullet points for lists',
      '- Use code blocks for code',
      '- Be concise, avoid unnecessary repetition',
      '- If you need multiple steps, explain the plan first'
    ].join('\n');
  }

  setTools(tools: Tool[]) { this.config.tools = tools; return this; }
  setCwd(cwd: string) { this.config.cwd = cwd; return this; }
  setPermissionMode(mode: 'accept' | 'deny' | 'ask') { this.config.permissionMode = mode; return this; }
  setProjectInstructions(instructions: string) { this.config.projectInstructions = instructions; return this; }
  setModel(model: string) { this.config.model = model; return this; }

  buildToolsFragment(): string { return this.buildToolInstructions(); }

  injectReminder(reminder: string): string {
    return '\n## Reminder\n\n' + reminder + '\n';
  }
}

let globalBuilder: SystemPromptBuilder | null = null;

export function getSystemPromptBuilder(config?: SystemPromptConfig): SystemPromptBuilder {
  if (!globalBuilder) globalBuilder = new SystemPromptBuilder(config);
  return globalBuilder;
}

export function updateSystemPrompt(tools?: Tool[], permissionMode?: 'accept' | 'deny' | 'ask') {
  if (globalBuilder) {
    if (tools) globalBuilder.setTools(tools);
    if (permissionMode) globalBuilder.setPermissionMode(permissionMode);
  }
}

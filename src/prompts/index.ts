/**
 * System Prompt Builder - Dynamic prompt construction
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Tool } from '../tools/types.js';

export interface SystemPromptConfig {
  cwd?: string;
  tools?: Tool[];
  includeProjectMd?: boolean;
  permissionMode?: 'accept' | 'deny' | 'ask';
  date?: Date;
  skillsPrompt?: string;
}

/**
 * v3.0.0: a single named fragment of the system prompt. The provider layer
 * attaches cache_control markers to volatile=false segments (Anthropic) and
 * the fingerprint module hashes only the non-volatile portion.
 */
export interface SystemSegment {
  /** Stable identifier, used in fingerprints and logging. */
  name: string;
  /** Rendered text content. May be empty string if the section was a no-op. */
  content: string;
  /**
   * volatile=false: content never changes between requests within a session.
   * volatile=true:  content may change (NWT events, current time).
   */
  volatile: boolean;
}

export class SystemPromptBuilder {
  private config: Required<SystemPromptConfig>;

  constructor(config: SystemPromptConfig = {}) {
    this.config = {
      cwd: config.cwd ?? process.cwd(),
      tools: config.tools ?? [],
      includeProjectMd: config.includeProjectMd ?? true,
      permissionMode: config.permissionMode ?? 'ask',
      date: config.date ?? new Date(),
      skillsPrompt: config.skillsPrompt ?? '',
    };
  }

  build(): string {
    return this.buildSegments()
      .map(s => s.content)
      .filter(Boolean)
      .join('\n\n');
  }

  /**
   * v3.0.0: build the system prompt as named segments instead of a flat
   * string. The provider layer (Anthropic) can attach cache_control markers
   * to the segments it caches, and the fingerprint module can hash the
   * static portion to detect when the immutable prefix changed.
   *
   * Ordering rule (Reasonix-style): immutable prefix first, volatile tail
   * last. NWT history and Date move to the tail because both can change
   * between rounds (Date: every build; NWT: when a new event is logged).
   * Keeping them out of the prefix means the upstream cache keeps its
   * prefix checkpoint stable across those changes.
   *
   * Segments with empty content are filtered out — they neither contribute
   * to the string output nor to any cache fingerprint.
   */
  buildSegments(): SystemSegment[] {
    return [
      // Immutable prefix (cacheable as a single block on Anthropic)
      { name: 'project-instructions', content: this.buildProjectInstructions(), volatile: false },
      { name: 'identity',              content: this.buildIdentity(),              volatile: false },
      { name: 'tool-instructions',     content: this.buildToolInstructions(),     volatile: false },
      { name: 'environment',           content: this.buildEnvironment(),           volatile: false },
      { name: 'permission-mode',       content: this.buildPermissionMode(),       volatile: false },
      { name: 'skills',                content: this.buildSkills(),                volatile: false },
      // Volatile tail — not part of the cache prefix
      { name: 'nwt-history',           content: this.buildNwtHistory(),           volatile: true  },
      { name: 'date-info',             content: this.buildDateInfo(),             volatile: true  },
    ].filter(s => s.content);
  }

  private buildIdentity(): string {
    return [
      'You are Thatgfsj Code, an interactive coding agent.',
      '',
      'IMPORTANT: You MUST follow the user configuration above (CLAUDE.md, SKILLS.md, etc).',
      'At the start of each task, read SKILLS.md to check for relevant skills.',
      '',
      'Tools available: file, shell, git, search, nwt.',
      '',
      'Rules:',
      '- Follow the user\'s technical preferences from their config',
      '- Be concise but thorough',
      '- Verify changes after making them',
      '',
      '## NWT Auto-Logging (IMPORTANT)',
      '',
      'After completing any meaningful task, you MUST evaluate whether to log it to NWT.',
      'Call `nwt log` automatically when ANY of these conditions are true:',
      '',
      '1. You created, modified, or deleted 2+ files',
      '2. You made an architectural decision (chose a library, pattern, or approach)',
      '3. You fixed a bug',
      '4. You added a new feature or capability',
      '5. You refactored existing code',
      '6. You set up a new project or module',
      '7. You resolved a security issue',
      '8. You completed a multi-step task',
      '',
      'Do NOT log:',
      '- Simple file reads or searches',
      '- Trivial single-line changes',
      '- Conversational questions with no code changes',
      '',
      'When logging, use:',
      '  nwt log task="<imperative verb> <what>" summary="<what was done>" files="<files>" tags="<tags>"',
      '',
      'Tags: feature, fix, refactor, decision, milestone, test, docs, config, security, init',
      '',
      'IMPORTANT: Log silently without mentioning it to the user unless they ask.',
    ].join('\n');
  }

  private buildToolInstructions(): string {
    const tools = this.config.tools;
    if (tools.length === 0) return '## Tools\n\nNo tools are currently registered.';

    const toolDescs = tools.map(t => {
      const params = t.parameters
        .map(p => `  - ${p.name} (${p.type}${p.required ? ', required' : ''}): ${p.description}`)
        .join('\n');
      return `### ${t.name}\n${t.description}\n\nParameters:\n${params}`;
    }).join('\n\n');

    return `## Tools\n\nYou have access to the following tools:\n\n${toolDescs}\n\nTo use a tool, respond with a tool call.`;
  }

  private buildEnvironment(): string {
    return `## Environment\n\nWorking directory: ${this.config.cwd}`;
  }

  private buildPermissionMode(): string {
    const mode = this.config.permissionMode;
    const explanations: Record<string, string> = {
      accept: 'All tool calls are automatically allowed without confirmation.',
      deny: 'All tool calls are blocked. You may only read and discuss.',
      ask: 'Dangerous or destructive commands require user confirmation before execution.',
    };
    return `## Permission Mode\n\nCurrent mode: ${mode}\n\n${explanations[mode] || ''}`;
  }

  /**
   * Read project instruction files (generic, works for any user)
   */
  private buildProjectInstructions(): string {
    if (!this.config.includeProjectMd) return '';

    const cwd = this.config.cwd;
    const home = process.env.USERPROFILE || process.env.HOME || '';

    // Project-level files (any project can have these)
    const projectFiles = [
      'CLAUDE.md', '.claude.md', 'AGENTS.md',
      'Codex.md', '.Codex.md', 'CODEX.md', '.codex.md',
      'CONVENTIONS.md', 'CONTRIBUTING.md',
    ];

    // User-level files (in home directory)
    const userDirs = ['.claude', '.Codex', '.agents'];
    const userFiles = ['CLAUDE.md', 'SKILLS.md', 'AGENTS.md', 'CONVENTIONS.md'];

    const paths: string[] = [];

    // Project-level
    for (const f of projectFiles) {
      paths.push(join(cwd, f));
    }

    // User-level
    for (const dir of userDirs) {
      for (const f of userFiles) {
        paths.push(join(home, dir, f));
      }
    }

    const sections: string[] = [];
    const MAX_LEN = 3000;

    for (const path of paths) {
      if (existsSync(path)) {
        try {
          let content = readFileSync(path, 'utf-8').trim();
          if (content) {
            const filename = path.split(/[/\\]/).pop();
            if (content.length > MAX_LEN) {
              content = content.slice(0, MAX_LEN) + '\n... (truncated)';
            }
            sections.push(`[${filename}]\n${content}`);
          }
        } catch {}
      }
    }

    if (sections.length === 0) return '';
    return `## User Configuration\n\n${sections.join('\n\n')}`;
  }

  /**
   * Auto-inject recent NWT history into system prompt
   */
  private buildNwtHistory(): string {
    try {
      const nwtDir = join(this.config.cwd, '.nwt', 'events');
      if (!existsSync(nwtDir)) return '';

      const files = readdirSync(nwtDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .slice(-10); // Last 10 events

      if (files.length === 0) return '';

      const events = files.map(f => {
        try {
          const ev = JSON.parse(readFileSync(join(nwtDir, f), 'utf-8'));
          const time = ev.timestamp?.split('T')[0] || '';
          const files = ev.files?.length > 0 ? ` [${ev.files.join(', ')}]` : '';
          return `- [${ev.id}] ${time} ${ev.task}: ${ev.summary}${files}`;
        } catch {
          return null;
        }
      }).filter(Boolean);

      if (events.length === 0) return '';

      return `## Project History (NWT)\n\nRecent evolution events:\n\n${events.join('\n')}`;
    } catch {
      return '';
    }
  }

  private buildSkills(): string {
    if (!this.config.skillsPrompt) return '';
    return `## Active Skills\n\n${this.config.skillsPrompt}`;
  }

  private buildDateInfo(): string {
    const now = this.config.date;
    const iso = now.toISOString().replace('T', ' ').split('.')[0];
    return `## Current Time\n\n${iso}`;
  }

  setTools(tools: Tool[]): this { this.config.tools = tools; return this; }
  setCwd(cwd: string): this { this.config.cwd = cwd; return this; }
  setPermissionMode(mode: 'accept' | 'deny' | 'ask'): this { this.config.permissionMode = mode; return this; }
}

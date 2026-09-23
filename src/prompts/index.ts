/**
 * System Prompt Builder - Dynamic prompt construction
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, resolve, parse } from 'path';
import * as os from 'os';
import { estimateTokens } from '../utils/tokens.js';
import type { Tool } from '../tools/types.js';

export interface SystemPromptConfig {
  cwd?: string;
  tools?: Tool[];
  includeProjectMd?: boolean;
  permissionMode?: 'accept' | 'deny' | 'ask' | 'plan';
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
      'IMPORTANT: You MUST follow the user configuration above (CLAUDE.md, AGENTS.md, SKILLS.md, etc).',
      'At the start of each task, read SKILLS.md to check for relevant skills.',
      '',
      'Tools available: file, shell, git, search, nwt, browser (web search & page reading via the local browser), apply_patch, update_plan, get_context_remaining.',
      '',
      'Edit policy:',
      '- To change existing code, prefer `apply_patch` (multi-file atomic patch with context anchors) over rewriting whole files with `file write`.',
      '- Keep 2-4 unchanged context lines around each `-`/`+` change so the patch location is unambiguous.',
      '- For tasks with 3+ distinct steps, call `update_plan` first, then keep step statuses current as you work; clear the plan when done.',
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

    // v3.5.4 (field report P0): the built-in 4B model dropped the content
    // parameter on 100% of file writes and leaked its own tool-template
    // markup (<parameter=…>, </tool_call>) as plain text. Small models need
    // the format spelled out with a concrete example, not just a parameter
    // list. v3.5.5: write lives on the dedicated write_file tool whose
    // schema REQUIRES content — the example now matches.
    const formatNote = tools.some(t => t.name === 'write_file')
      ? `

### Tool call format (strict)

Tool calls are issued through the function-calling channel — never as text.
Do NOT write markup like <tool_call>, <parameter=name>, or XML/Fenced blocks
in your message: the runtime cannot execute those.

Every parameter listed as required MUST be present with a non-empty value.
Example — creating or overwriting a file (content is mandatory):

  write_file { "path": "notes/hello.txt", "content": "hello world" }

Example — reading one (never pass content):

  file { "action": "read", "path": "notes/hello.txt" }`
      : '';

    return `## Tools\n\nYou have access to the following tools:\n\n${toolDescs}\n\nTo use a tool, respond with a tool call.${formatNote}`;
  }

  private buildEnvironment(): string {
    // v3.5.0 (field report): the model used to open with `ls -la` on a
    // Chinese Windows CMD box and waste a round. Tell it the OS, the
    // shell, and the local command dialect up front.
    const platform = process.platform;
    const release = os.release();
    const comspec = (process.env.ComSpec || 'cmd.exe').split(/[\\/]/).pop();
    const lines = [
      '## Environment',
      '',
      `Working directory: ${this.config.cwd}`,
      `OS: ${platform} ${release}`,
    ];
    if (platform === 'win32') {
      lines.push(
        `Shell: ${comspec || 'cmd.exe'} (Windows — use dir/type/where, not ls/cat/which; paths use backslashes)`,
      );
    } else {
      lines.push(`Shell: ${process.env.SHELL?.split('/').pop() || 'bash'} (POSIX)`);
    }
    return lines.join('\n');
  }

  private buildPermissionMode(): string {
    const mode = this.config.permissionMode;
    const explanations: Record<string, string> = {
      accept: 'FULL PERMISSION MODE: All tool calls are automatically allowed without confirmation.',
      deny: 'All tool calls are blocked. You may only read and discuss.',
      ask: 'Read-only commands (git status, ls, cat, …) run without confirmation. Writes, deletions, and anything that executes or installs requires user confirmation first.',
      plan: [
        'PLAN MODE (read-only research): You may read files, search, and run read-only commands.',
        'Every write, delete, or execute attempt is AUTO-DENIED. Research the request thoroughly,',
        'then call update_plan to lay out the implementation steps and present the plan concisely. STOP after the plan —',
        'do not attempt any modification. The user will approve your plan to grant full permissions.',
      ].join(' '),
    };
    return `## Permission Mode\n\nCurrent mode: ${mode}\n\n${explanations[mode] || ''}`;
  }

  /**
   * Read project instruction files (Codex-style AGENTS.md chain).
   *
   * v3.0.20: discovery now walks the full chain instead of only the cwd —
   *   1. global   ~/.thatgfsj/AGENTS.md (+ legacy ~/.claude, ~/.Codex, ~/.agents)
   *   2. ancestors parent dirs of cwd, outermost first (AGENTS.md / CLAUDE.md)
   *   3. cwd      the project file list (AGENTS.md, CLAUDE.md, CONVENTIONS.md…)
   * Later (more specific, closer to cwd) files are appended last so the
   * model treats them as the final word. Paths are deduped case-insensitively
   * (Windows) so an AGENTS.md reached via the ancestor walk and the cwd list
   * is only included once. Per-file cap stays at MAX_LEN; total sections are
   * bounded by MAX_SECTIONS to keep the system prompt size predictable.
   */
  private buildProjectInstructions(): string {
    if (!this.config.includeProjectMd) return '';

    const cwd = resolve(this.config.cwd);
    const home = process.env.USERPROFILE || process.env.HOME || '';

    // Project-level files (any project can have these)
    const projectFiles = [
      'CLAUDE.md', '.claude.md', 'AGENTS.md',
      'Codex.md', '.Codex.md', 'CODEX.md', '.codex.md',
      'CONVENTIONS.md', 'CONTRIBUTING.md',
    ];

    // User-level files (in home directory)
    const userDirs = ['.thatgfsj', '.claude', '.Codex', '.agents'];
    const userFiles = ['AGENTS.md', 'CLAUDE.md', 'SKILLS.md', 'CONVENTIONS.md'];

    const entries: Array<{ path: string; label: string }> = [];

    // 1. Global user-level instructions first.
    for (const dir of userDirs) {
      for (const f of userFiles) {
        const p = join(home, dir, f);
        entries.push({ path: p, label: `${f} @ ${join('~', dir)}` });
      }
    }

    // 2. Ancestor directories of cwd, outermost → closest-to-cwd (Codex
    // AGENTS.md chain). The walk stops at the project root — the nearest
    // ancestor containing a .git entry — so a stray AGENTS.md above the
    // repo cannot leak in. Without a project marker we fall back to the
    // filesystem root.
    const ancestorFiles = ['AGENTS.md', 'CLAUDE.md'];
    const ancestors: string[] = [];
    {
      // Project root = nearest dir from cwd upward containing a .git entry.
      let boundary: string | null = null;
      for (let d = cwd; ; d = dirname(d)) {
        if (existsSync(join(d, '.git'))) { boundary = d; break; }
        const p = dirname(d);
        if (p === d) break;
      }
      if (boundary !== null && boundary !== cwd) {
        // From the project root down to just above cwd (cwd is handled by
        // the projectFiles pass below).
        const up: string[] = [];
        for (let d = dirname(cwd); ; d = dirname(d)) {
          up.push(d);
          if (d === boundary) break;
          if (dirname(d) === d) break; // marker vanished mid-walk — stop at root
        }
        up.reverse();
        ancestors.push(...up);
      } else if (boundary !== cwd) {
        // No project marker above cwd: only the two nearest levels above —
        // a full walk to the filesystem root would burn the section budget
        // on unrelated directories.
        // (v3.5.4: boundary === cwd — cwd IS the git root — pushes NOTHING;
        // the old fallthrough leaked the PARENT directory's AGENTS.md into
        // the prompt. Field report, round 7.)
        const a = dirname(cwd);
        const b = dirname(a);
        if (a !== cwd) ancestors.push(a);
        if (b !== a) ancestors.push(b);
        ancestors.reverse();
      }
    }
    for (const anc of ancestors) {
      for (const f of ancestorFiles) {
        const p = join(anc, f);
        entries.push({ path: p, label: `${f} @ ${anc}` });
      }
    }

    // 3. cwd last — most specific, appended last.
    for (const f of projectFiles) {
      entries.push({ path: join(cwd, f), label: `${f} @ ${cwd}` });
    }

    const MAX_LEN = 3000;
    const MAX_SECTIONS = 10;
    // v3.0.20: cumulative budget across ALL instruction files (Codex uses a
    // 32KiB byte budget; 16k chars here keeps the system prompt lean while
    // allowing global + several project layers).
    const MAX_TOTAL = 16000;
    const seen = new Set<string>();
    const sections: string[] = [];
    let total = 0;

    for (const { path, label } of entries) {
      if (sections.length >= MAX_SECTIONS || total >= MAX_TOTAL) break;
      const key = resolve(path).toLowerCase();
      if (seen.has(key)) continue;
      if (!existsSync(path)) continue;
      try {
        let content = readFileSync(path, 'utf-8').trim();
        if (content) {
          if (content.length > MAX_LEN) {
            content = content.slice(0, MAX_LEN) + '\n... (truncated)';
          }
          if (total + content.length > MAX_TOTAL) {
            content = content.slice(0, Math.max(0, MAX_TOTAL - total)) + '\n... (truncated, budget exhausted)';
          }
          seen.add(key);
          total += content.length;
          sections.push(`[${label}]\n${content}`);
        }
      } catch {}
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
  setPermissionMode(mode: 'accept' | 'deny' | 'ask' | 'plan'): this { this.config.permissionMode = mode; return this; }

  /**
   * v3.2.0: token breakdown for the TUI context panel (opencode-style
   * 上下文容量 sidebar). Estimates, not exact counts — same CJK-aware
   * heuristic as everywhere else. Categories mirror the request anatomy:
   *   - systemPrompt: every prompt segment EXCEPT tool-instructions and
   *     skills (identity, AGENTS.md chain, environment, mode, NWT, date)
   *   - toolInstructions: the how-to-call-tools segment. v3.6.0: counted
   *     now — it rode the wire but was invisible to the breakdown, which
   *     made preCall estimates run ~1200 tokens light (field-report P1-6).
   *   - systemTools: JSON schemas of built-in tools (what actually rides
   *     on the wire as the tools array, minus MCP tools)
   *   - mcpTools: JSON schemas of mcp__-prefixed tools
   *   - skills: the Active Skills segment
   * Message tokens are added by the caller (session lives outside here).
   */
  estimateBreakdown(): {
    systemPrompt: number; toolInstructions: number; systemTools: number; mcpTools: number; skills: number;
  } {
    let systemPrompt = 0;
    let toolInstructions = 0;
    let skills = 0;
    for (const s of this.buildSegments()) {
      const t = estimateTokens(s.content);
      if (s.name === 'skills') skills += t;
      else if (s.name === 'tool-instructions') toolInstructions += t;
      else systemPrompt += t;
    }
    const schemaJson = (tools: Tool[]) => estimateTokens(JSON.stringify(
      tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters }))
    ));
    const builtin = this.config.tools.filter(t => !t.name.startsWith('mcp__'));
    const mcp = this.config.tools.filter(t => t.name.startsWith('mcp__'));
    return { systemPrompt, toolInstructions, systemTools: schemaJson(builtin), mcpTools: schemaJson(mcp), skills };
  }
}

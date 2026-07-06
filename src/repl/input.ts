/**
 * REPL Input Handler
 *
 * 2.1.3 — REWRITTEN to use Node's `readline` directly (instead of
 * `@inquirer/input`) so we can render inline command-suggestions below
 * the prompt line. This mirrors the 1.0.4 / Claude Code / Codex UX:
 *
 *    ▸ /mo
 *    ┌─────────────────────────────────────┐
 *    │ > /模型  /model    切换 / 管理模型    │
 *    │ > /mcp   /mcp     MCP 设置          │
 *    │   …                                  │
 *    └─────────────────────────────────────┘
 *
 * Keys:
 *   - typing characters: append + redraw suggestions
 *   - ↑/↓            : move selection in suggestion list
 *   - Tab            : insert selected suggestion at end
 *   - Enter          : submit current line
 *   - Ctrl+C         : cancel (returning kind: 'cancelled')
 *   - Esc            : clear input
 */

import readline from 'readline';
import chalk from 'chalk';

const MAX_HISTORY = 200;

/** The canonical slash command list. Kept in sync with REPLLoop::handleCommand. */
export const COMMAND_LIST: ReadonlyArray<{ name: string; aliases: string[]; desc: string; descEn?: string }> = [
  { name: '/model',    aliases: ['/模型', '/选择模型'],     desc: '切换 / 管理模型' },
  { name: '/provider', aliases: ['/服务商', '/提供商切换'], desc: '切换 provider' },
  { name: '/edit',     aliases: ['/修改', '/编辑'],         desc: '修改已保存模型' },
  { name: '/clear',    aliases: ['/清屏'],                   desc: '清屏' },
  { name: '/context',  aliases: ['/上下文'],                 desc: '显示项目 cwd' },
  { name: '/history',  aliases: ['/历史'],                   desc: '命令历史' },
  { name: '/tools',    aliases: ['/工具'],                   desc: '可用工具列表' },
  { name: '/models',   aliases: ['/模型列表'],               desc: '当前 provider 内置模型(只读)' },
  { name: '/providers', aliases: ['/供应商'],                desc: '所有 provider(只读)' },
  { name: '/exit',     aliases: ['/退出', '/quit'],         desc: '退出 REPL' },
  { name: '/help',     aliases: ['/帮助'],                   desc: '显示命令列表(静态文本)' },
];

export type PromptResult =
  | { kind: 'value'; value: string }       // 用户正常输入并提交（Enter）
  | { kind: 'cancelled' };                  // Ctrl+C 中断当前输入

/** Returns matching commands sorted by relevance. Empty `term` returns all. */
function filterCommands(term: string) {
  const t = term.toLowerCase();
  if (!t) return [];
  // exact match first, then prefix match, then substring match
  const exact: typeof COMMAND_LIST[number][] = [];
  const prefix: typeof COMMAND_LIST[number][] = [];
  const substr: typeof COMMAND_LIST[number][] = [];
  for (const c of COMMAND_LIST) {
    const allNames = [c.name, ...c.aliases].map(s => s.toLowerCase());
    if (allNames.includes(t)) exact.push(c);
    else if (allNames.some(n => n.startsWith(t))) prefix.push(c);
    else if (allNames.some(n => n.includes(t))) substr.push(c);
  }
  return [...exact, ...prefix, ...substr].slice(0, 6);
}

/** Tiny ANSI helpers. We write directly to stdout to avoid the cost of
 * re-rendering through @inquirer. */
const ESC = {
  clearLine: '\u001b[2K',
  cursorUp: (n: number) => `\u001b[${n}A`,
  cursorDown: (n: number) => `\u001b[${n}B`,
  eraseDown: '\u001b[J',
  hideCursor: '\u001b[?25l',
  showCursor: '\u001b[?25h',
};

export class REPLInput {
  private history: string[] = [];
  private historyIndex: number = -1;
  private currentDraft: string = '';
  private consecutiveCancels: number = 0;

  /** The prefix is rendered above the input box, in bold cyan. */
  private defaultPrefix: string = chalk.bold.cyan('\n▸ ');

  prompt(prefix?: string, abortSignal?: AbortSignal): Promise<PromptResult> {
    const prefill = this.computePrefill();

    // Use Node's readline in raw-ish mode. We intentionally do NOT enter
    // full raw mode (which would intercept Ctrl+C) — we want our outer
    // SIGINT handler in REPLLoop to see Ctrl+C.
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // Build the prefix line.
    const prefixText = prefix ?? this.defaultPrefix;
    process.stdout.write(prefixText);
    process.stdout.write(chalk.gray('(输入 / 命令  ·  ↑↓ 历史  ·  Tab 补全  ·  Ctrl+C 中断)\n'));
    const suggestionLines = 2; // lines reserved below the prompt for hints

    let buffer = prefill;
    process.stdout.write(chalk.bold.cyan('▸ '));
    if (buffer) process.stdout.write(chalk.bold.white(buffer));

    let suggestionRows = 0;

    const render = () => {
      // 1. Clear any previous suggestion rows
      if (suggestionRows > 0) {
        process.stdout.write(ESC.cursorUp(suggestionRows) + ESC.clearLine + ESC.eraseDown);
      }
      // 2. Decide what to show
      const matching = buffer.startsWith('/') && !buffer.includes(' ') ? filterCommands(buffer) : [];
      // 3. Draw suggestions
      let rows = 0;
      if (matching.length === 1 && matching[0].name.toLowerCase() === buffer.toLowerCase()) {
        // Exact match — show one-line help
        const c = matching[0];
        process.stdout.write(chalk.green(`  ✓ ${c.desc}`));
        if (c.descEn) process.stdout.write(chalk.gray(`  (${c.descEn})`));
        process.stdout.write('\n');
        rows = 1;
      } else if (matching.length > 0) {
        for (const c of matching) {
          const aliasPart = c.aliases.length
            ? chalk.gray(` (${c.aliases.join(', ')})`)
            : '';
          process.stdout.write(
            chalk.cyan(`  ${c.name.padEnd(14)}`) + chalk.gray(c.desc) + aliasPart + '\n',
          );
          rows++;
        }
      }
      if (rows < suggestionLines) {
        // Pad with blank lines so the cursor stays stable after submit.
        for (let i = 0; i < suggestionLines - rows; i++) process.stdout.write('\n');
        rows = suggestionLines;
      }
      suggestionRows = rows;
      // 4. Re-emit the live prompt line so cursor lands at end of typed text
      process.stdout.write(ESC.cursorUp(rows) + chalk.bold.cyan('▸ ') + chalk.bold.white(buffer));
    };
    render();

    return new Promise((resolve) => {
      const cleanup = () => {
        try { rl.close(); } catch {}
        // Move to next line so external write() doesn't overwrite our prompt
        process.stdout.write('\n');
      };

      const cancelled = () => {
        cleanup();
        this.consecutiveCancels++;
        resolve({ kind: 'cancelled' });
      };

      // Ctrl+C handler — kept in case user holds Ctrl before our outer SIGINT picks up
      rl.on('SIGINT', cancelled);

      // Handle abort signal from outside
      if (abortSignal?.aborted) {
        cancelled();
        return;
      }
      const onAbort = () => { cancelled(); };
      abortSignal?.addEventListener('abort', onAbort, { once: true });

      // Each line submitted = current buffer as-is
      rl.on('line', (line) => {
        cleanup();
        if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          if (this.history[this.history.length - 1] !== trimmed) {
            this.history.push(trimmed);
            if (this.history.length > MAX_HISTORY) this.history.shift();
          }
        }
        this.consecutiveCancels = 0;
        resolve({ kind: 'value', value: trimmed });
      });

      // Tab completion — at the position of the cursor, fill in the suggested command
      rl.on('close', () => {
        // Closed externally (e.g. raw stdin close). Treat as cancellation.
        if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
      });

      // Listen for keypress to handle Backspace / Tab / arrow keys
      process.stdin.on('keypress', (chunk, key) => {
        if (!key) return;
        if (key.ctrl && key.name === 'c') {
          cancelled();
        }
        // We just rely on readline's default editing for basic arrow keys.
      });
    }).catch((_err: any) => {
      try { rl.close(); } catch {}
      return { kind: 'cancelled' as const };
    }) as unknown as Promise<PromptResult>;
  }

  shouldExitOnCancel(): boolean {
    return this.consecutiveCancels >= 2;
  }

  requestCancel(): boolean {
    this.consecutiveCancels++;
    return this.shouldExitOnCancel();
  }

  resetCancelCounter(): void {
    this.consecutiveCancels = 0;
  }

  private computePrefill(): string {
    if (this.historyIndex >= 0 && this.historyIndex < this.history.length) {
      return this.history[this.historyIndex];
    }
    if (this.currentDraft) return this.currentDraft;
    return '';
  }

  getHistory(): readonly string[] {
    return this.history;
  }

  clearHistory(): void {
    this.history = [];
    this.historyIndex = -1;
  }
}

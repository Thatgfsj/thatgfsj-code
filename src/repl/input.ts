/**
 * REPL Input Handler
 *
 * 2.1.4 — REVERTED to a simple, safe prompt using Node's `readline`.
 *
 * The 2.1.3 version tried to do inline command suggestions with raw ANSI
 * escape sequences. It compiled fine but caused OOM at runtime — every
 * prompt() call leaked:
 *   - a fresh readline interface (one per call — 100 turns = 100 rl instances)
 *   - a `process.stdin.on('keypress', ...)` listener that was never removed
 *   - closure state hooked to prompt-local Promise resolve() callbacks
 *
 * After a few minutes of use, V8 piled up hundreds of deferred resolves,
 * tens of MB of chalk strings, and ultimately OOM-killed the process.
 *
 * 2.1.4 simplifies back to plain readline + a single-shot "did you mean"
 * suggestion printed AFTER the user submits something that didn't match
 * a known command. So the flow is:
 *
 *   1. readline draws its own prompt
 *   2. user types + Enter
 *   3. if the input is `/foo` and `/foo` isn't a known command, we print
 *      "Did you mean …?" right above the new prompt
 *
 * This is far less ambitious than 2.1.3's "live filter" but it's stable,
 * has zero render-overlap bugs, and catches the most common typo case.
 *
 * The 1.0.4 / Claude Code "true inline completion" still requires Ink
 * or a different stack; we don't have it on this stack. We promise a
 * safe, predictable REPL — that's the priority.
 */

import readline from 'readline';
import chalk from 'chalk';

const MAX_HISTORY = 200;

export type PromptResult =
  | { kind: 'value'; value: string }       // 用户正常输入并提交（Enter）
  | { kind: 'cancelled' };                  // Ctrl+C 中断当前输入

/**
 * Canonical slash command list. Used for:
 *   - /help text
 *   - "did you mean …?" when user types an unrecognized slash command
 *   - runCommandPicker (legacy 2.1.2 path, no longer wired by default)
 *
 * Keep this list aligned with the case-labels in REPLLoop::handleCommand.
 */
export const COMMAND_LIST: ReadonlyArray<{
  name: string;
  aliases: string[];
  desc: string;
}> = [
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

/** Find the closest match for a /foo that's NOT in COMMAND_LIST.
 *  Returns a short hint string or empty. */
export function suggestCommand(input: string): string {
  const candidate = input.trim().toLowerCase();
  if (!candidate.startsWith('/') || candidate.length < 2) return '';
  // Direct alias / name match (case-sensitive on aliases since 中文 matters)
  for (const c of COMMAND_LIST) {
    if (c.aliases.includes(candidate)) {
      return `提示: '${input}' 是 '${c.name}' 的中文别名。`;
    }
  }
  // Fuzzy: distance against all known names + aliases; pick the closest
  let best: { cmd: typeof COMMAND_LIST[number]; score: number } | null = null;
  for (const c of COMMAND_LIST) {
    const names = [c.name, ...c.aliases];
    for (const n of names) {
      const s = fuzzyScore(candidate, n.toLowerCase());
      if (s > 0 && (!best || s > best.score)) {
        best = { cmd: c, score: s };
      }
    }
  }
  if (best) {
    return `提示: 未识别 '${input}'。是否指 '${best.cmd.name}' (${best.cmd.desc}) ?`;
  }
  return `提示: 未识别 '${input}'。输入 /help 查看完整命令列表。`;
}

/** Crude similarity: returns a non-zero score if the strings share a
 *  common prefix or are within edit distance 2, else 0. */
function fuzzyScore(a: string, b: string): number {
  let pref = 0;
  while (pref < a.length && pref < b.length && a[pref] === b[pref]) pref++;
  if (pref === 0) return 0;
  const rest = Math.abs(a.length - b.length) + (a.length - pref) + (b.length - pref);
  return pref - rest * 0.5; // strong common prefix, weak penalty on distance
}

export class REPLInput {
  private history: string[] = [];
  private historyIndex: number = -1;     // -1 means "not browsing history"
  private currentDraft: string = '';     // preserved when leaving history
  private consecutiveCancels: number = 0;
  // 2.1.4: cool green prompt + persistent hint line above the readline frame
  private defaultPrefix: string =
    chalk.bold.cyan('▸ ') +
    chalk.gray('(输入 / 命令 ·  ↑↓ 历史 ·  Ctrl+C 中断 / 二次退出) ');

  async prompt(prefix?: string, abortSignal?: AbortSignal): Promise<PromptResult> {
    const prefill = this.computePrefill();

    // Single readline interface per prompt — guarantees cleanup on every
    // code path. 2.1.3's bug was that we created new readline interfaces
    // in render() and never closed them.
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      // Don't print readline's own "[prompt]" prefix — we paint our own.
      prompt: '',
    });

    // Write our prefix + hint line BEFORE handing control to readline.
    // We use \x1b[?25l/h to prevent flicker between our manual writes
    // and readline's drawing.
    try {
      process.stdout.write(this.hideCursor);
      process.stdout.write(prefix ?? this.defaultPrefix);
      if (prefill) {
        process.stdout.write(prefill);
        rl.write(prefill);   // make it editable
      }
      process.stdout.write('\n');
      process.stdout.write(this.showCursor);
    } catch {
      /* best effort */
    }

    return new Promise<PromptResult>((resolve) => {
      let resolved = false;
      const finalize = (r: PromptResult) => {
        if (resolved) return;
        resolved = true;
        try { rl.close(); } catch {}
        // Move to a fresh line so the next prompt or output starts cleanly.
        try { process.stdout.write('\n'); } catch {}
        resolve(r);
      };

      // Ctrl+C at the prompt -> cancel
      rl.on('SIGINT', () => {
        this.consecutiveCancels++;
        finalize({ kind: 'cancelled' });
      });

      // External abort signal
      if (abortSignal?.aborted) {
        finalize({ kind: 'cancelled' });
        return;
      }
      const onAbort = () => finalize({ kind: 'cancelled' });
      abortSignal?.addEventListener('abort', onAbort, { once: true });

      // Enter
      rl.on('line', (line) => {
        if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
        const trimmed = line.replace(/\r$/, '').trim();
        if (trimmed.length > 0) {
          if (this.history[this.history.length - 1] !== trimmed) {
            this.history.push(trimmed);
            if (this.history.length > MAX_HISTORY) this.history.shift();
          }
        }
        this.consecutiveCancels = 0;
        finalize({ kind: 'value', value: trimmed });
      });

      // rl.close() externally (e.g. stdin EOF) — treat as cancel
      rl.on('close', () => {
        if (!resolved) finalize({ kind: 'cancelled' });
      });
    });
  }

  // ANSI helpers (kept tiny)
  private hideCursor = '\u001b[?25l';
  private showCursor = '\u001b[?25h';

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

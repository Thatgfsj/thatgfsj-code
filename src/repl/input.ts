/**
 * REPL Input Handler
 *
 * 基于 @inquirer/input 实现，支持：
 *   - 方向键（含数字小键盘方向键）行内移动 / 跳转词首尾
 *   - Home / End / Backspace / Delete 行内编辑
 *   - Ctrl+A / Ctrl+E 跳到行首/行尾（emacs 风格）
 *   - Ctrl+C 中断当前输入（不清空整个会话），连续按两次空输入退出
 *   - 命令历史：本地维护 history 数组，通过 default 预填上一条
 *
 * 不再使用 Node 内置 readline 的 rl.question()——它在 Windows 终端下
 * 对小键盘方向键的 ANSI 转义序列不友好，会导致光标无法移动 (Bug #1)。
 */

import input from '@inquirer/input';
import chalk from 'chalk';

const MAX_HISTORY = 200;

export type PromptResult =
  | { kind: 'value'; value: string }       // 用户正常输入并提交（Enter）
  | { kind: 'cancelled' };                  // Ctrl+C 中断当前输入

export class REPLInput {
  private history: string[] = [];
  private historyIndex: number = -1;        // -1 表示"未在历史中浏览"
  private currentDraft: string = '';        // 离开历史时保留用户原始草稿
  private consecutiveCancels: number = 0;   // 连续空输入 + Ctrl+C 计数,达到阈值退出
  // 2.1.1: 提示符更显眼了 — `▸` + chalk 加粗 cyan,输入区用 chalk.bold。
  // 同时加一行提示,告诉用户 `/` 调出命令面板、↑↓ 翻历史。
  private defaultPrefix: string =
    chalk.bold.cyan('\n▸ ') + chalk.gray('(输入 / 看命令  ·  ↑↓ 历史  ·  Ctrl+C 中断)  ');

  /**
   * Ask the user for input. Returns either a value or 'cancelled'.
   * Loop decides what to do with cancellation (usually: continue session,
   * unless user has cancelled an already-empty input twice in a row).
   */
  async prompt(prefix?: string, abortSignal?: AbortSignal): Promise<PromptResult> {
    const prefill = this.computePrefill();
    const previousDraft = prefill.kind === 'history' ? prefill.value : '';

    // 用 abortSignal 绑到 inquirer:外面 Ctrl+C / 主进程事件可以取消
    const value = await input({
      message: prefix ?? this.defaultPrefix,
      theme: {
        prefix: chalk.bold.cyan('▸'),
        style: { answer: chalk.bold.white },
      },
      prefill: 'editable',                  // 关键:启用方向键 + 行内编辑,包括小键盘
      default: previousDraft,               // 历史预填
      // Ctrl+C 由 @inquirer/input 抛出一个 symbol-like 错误,我们捕获为 cancelled
      validate: () => true,
    }, abortSignal ? { signal: abortSignal } : undefined).catch((err: any) => {
      // 区分真实错误与用户取消;inquirer 用 ExitPromptError (name: 'ExitPromptError')
      if (err && (err.name === 'ExitPromptError' || err.message?.includes('User force closed'))) {
        return null;
      }
      throw err;
    });

    if (value === null || value === undefined) {
      this.consecutiveCancels++;
      return { kind: 'cancelled' };
    }

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      // 避免把连续重复的内容都压入历史
      if (this.history[this.history.length - 1] !== trimmed) {
        this.history.push(trimmed);
        if (this.history.length > MAX_HISTORY) this.history.shift();
      }
    }

    this.consecutiveCancels = 0;
    return { kind: 'value', value: trimmed };
  }

  /**
   * Should we ask the loop to exit? Two consecutive Ctrl+C on empty input => exit.
   */
  shouldExitOnCancel(): boolean {
    return this.consecutiveCancels >= 2;
  }

  /**
   * Programmatic cancel trigger (used by the global SIGINT handler in REPLLoop).
   * Increments the cancel counter as if a Ctrl+C had been seen, and returns
   * whether the loop should now exit. Idempotent across the prompt() flow:
   * if the user has already entered a non-empty prompt this is a no-op for exit
   * (the loop keeps running) — but for an empty REPL it eventually returns true.
   */
  requestCancel(): boolean {
    // 模拟一次空输入 cancel:计为 1,下一次 SIGINT 累计到 2 即退出
    this.consecutiveCancels++;
    return this.shouldExitOnCancel();
  }

  /**
   * Reset consecutive-cancel counter when the loop has decided to keep running.
   */
  resetCancelCounter(): void {
    this.consecutiveCancels = 0;
  }

  /**
   * Decide what to prefill. Two modes:
   *   - 'history': when user is navigating up/down with arrows
   *   - 'draft':   when user has cleared the input — preserve their draft
   */
  private computePrefill(): { kind: 'history' | 'draft' | 'none'; value: string } {
    if (this.historyIndex >= 0 && this.historyIndex < this.history.length) {
      return { kind: 'history', value: this.history[this.historyIndex] };
    }
    if (this.currentDraft) return { kind: 'draft', value: this.currentDraft };
    return { kind: 'none', value: '' };
  }

  /**
   * Save the user's in-progress draft so ↑↓ preserves their unsent typing.
   */
  saveDraft(text: string): void {
    this.currentDraft = text;
  }

  /**
   * Navigate up in history (called from a global key listener, if needed).
   */
  historyUp(): string {
    if (this.history.length === 0) return this.currentDraft;
    if (this.historyIndex < 0) this.historyIndex = this.history.length;
    if (this.historyIndex > 0) this.historyIndex--;
    return this.history[this.historyIndex] ?? '';
  }

  /**
   * Navigate down in history.
   */
  historyDown(): string {
    if (this.history.length === 0) return this.currentDraft;
    if (this.historyIndex >= this.history.length) return this.currentDraft;
    this.historyIndex++;
    if (this.historyIndex >= this.history.length) {
      this.historyIndex = this.history.length;
      return this.currentDraft;
    }
    return this.history[this.historyIndex] ?? '';
  }

  getHistory(): readonly string[] {
    return this.history;
  }

  clearHistory(): void {
    this.history = [];
    this.historyIndex = -1;
  }
}

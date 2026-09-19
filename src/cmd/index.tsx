#!/usr/bin/env node

/**
 * Thatgfsj Code - CLI Entry Point
 *
 * v3.0.5:
 *   - Version now comes from package.json via src/version.ts (was hardcoded
 *     in four places and drifted three ways).
 *   - The Windows chcp fix used `require('child_process')` inside ESM — a
 *     ReferenceError silently swallowed by try/catch, so it never ran. It
 *     now uses a proper import, and only executes for interactive TTYs
 *     (headless/--json/CI never pay the subprocess cost).
 *   - Headless mode: positional prompt + `--json` emits line-delimited JSON
 *     events on stdout (all human-readable output moves to stderr), so the
 *     CLI is scriptable: `gfcode "summarize" --json | jq .`.
 *   - `--yolo` runs without tool confirmations. Without it, single-prompt
 *     mode asks on a TTY, denies otherwise — never silently executes.
 */

import { execSync } from 'child_process';
import { program } from 'commander';
import chalk from 'chalk';
import { App } from '../app/index.js';
import { WelcomeScreen } from '../tui/welcome.js';
import { compressThinking, summarizeThinking, splitThinking } from '../utils/thinking.js';
import { getVersion } from '../version.js';
import type { ConfirmRequest } from '../app/index.js';
import type { ToolCallResult } from '../types.js';

process.on('uncaughtException', (error) => {
  console.error(chalk.red('\n  Error:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('\n  Error:'), reason);
  process.exit(1);
});

/**
 * Windows consoles default to a GBK code page; chcp 65001 switches them to
 * UTF-8 before any Chinese output renders. Interactive TTYs only.
 */
function ensureUtf8Console(): void {
  if (process.platform !== 'win32') return;
  try {
    execSync('chcp 65001 >NUL', { stdio: 'ignore', windowsHide: true });
  } catch {
    // Non-Windows shell, or chcp unavailable (e.g. git-bash on CI) —
    // that's fine, Node defaults to UTF-8 in that environment.
  }
}

program
  .name('gfcode')
  .description('Thatgfsj Code - AI Coding Assistant')
  .version(getVersion())
  .argument('[prompt]', 'Task to execute (omit to start interactive mode)')
  .option('-m, --model <model>', 'Specify model')
  .option('-i, --interactive', 'Force interactive mode')
  .option('--show-thinking', 'Show full <think>...</think> reasoning blocks (default: compress to one-line summary)')
  .option('--json', 'Headless JSON output: line-delimited events on stdout, human text on stderr')
  .option('--yolo', 'Allow all tool actions without confirmation')
  .option('-t, --thinking <level>', 'Reasoning effort for thinking-capable models: off|low|medium|high', (v: string) => {
    if (!['off', 'low', 'medium', 'high'].includes(v)) {
      throw new Error('--thinking 只接受 off | low | medium | high');
    }
    return v as 'off' | 'low' | 'medium' | 'high';
  })
  .action(async (prompt: string | undefined, options: {
    model?: string; interactive?: boolean; showThinking?: boolean; json?: boolean; yolo?: boolean; thinking?: 'off' | 'low' | 'medium' | 'high';
  }) => {
    try {
      const jsonMode = !!options.json;
      if (!jsonMode && process.stdout.isTTY) {
        ensureUtf8Console();
      }

      const app = await App.create();
      app.setYolo(!!options.yolo);

      if (options.thinking) {
        await app.setModelThinking(app.config.get().model, options.thinking);
      }

      // Check if API key is configured
      if (!app.config.hasApiKey()) {
        // In --json mode the setup wizard can not work — report and exit.
        if (jsonMode) {
          process.stdout.write(JSON.stringify({
            type: 'error',
            message: 'No API key configured. Run `gfcode init` first.',
          }) + '\n');
          process.exit(1);
        }
        console.log(chalk.yellow('\n  ⚠  No API key configured\n'));
        console.log(chalk.gray('  Run ') + chalk.cyan('gfcode init') + chalk.gray(' to set up your provider.\n'));
        const readline = await import('node:readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>(resolve => {
          rl.question(chalk.cyan('  Run init now? (Y/n): '), resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== 'n') {
          await WelcomeScreen.interactiveSetup();
          // Reload config after setup
          const newApp = await App.create();
          newApp.setYolo(!!options.yolo);
          Object.assign(app, newApp);
        } else {
          process.exit(0);
        }
      }

      if (options.model) {
        await app.config.save({ model: options.model });
        await app.reloadModel();
      }

      // v3.0.13: first-run browser (Playwright) setup — interactive only,
      // asked once, persisted. Never in headless/--json mode.
      if (!jsonMode && process.stdin.isTTY) {
        const { ensureBrowserSetup } = await import('../setup/browser-setup.js');
        await ensureBrowserSetup(app.config);
      }

      if (!prompt || options.interactive) {
        // v3.0.9 fix (black-box finding): interactive TUI requires a TTY —
        // Ink's useInput needs raw mode and crashes with a stack trace on
        // piped stdin. Refuse gracefully; scripting should use --json.
        if (!process.stdin.isTTY && !process.env.GFCODE_FORCE_TUI) {
          console.error(chalk.yellow('\n  gfcode 需要交互式终端（TTY）才能启动 TUI。'));
          console.error(chalk.gray('  脚本化调用请使用: gfcode "任务" --json\n'));
          process.exit(1);
        }
        // Interactive mode - Ink TUI, full-screen via the alternate screen
        // buffer (opencode-style: owns the whole viewport, terminal is
        // restored on exit). Ink v7 has no fullscreen option, so we drive
        // the alt screen manually.
        const { render } = await import('ink');
        const { TuiApp } = await import('../tui/app.js');
        const out = process.stdout;
        const altScreen = !!out.isTTY;
        if (altScreen) {
          // v3.0.8: set the terminal window/tab title and enter the
          // alternate screen buffer.
          out.write('\x1b]2;Thatgfsj\x07');
          out.write('\x1b[?1049h\x1b[2J\x1b[H');
        }
        try {
          const instance = render(<TuiApp app={app} />);
          const restore = () => instance.unmount();
          process.once('exit', restore);
          await instance.waitUntilExit();
          process.removeListener('exit', restore);
        } finally {
          if (altScreen) out.write('\x1b[?1049l');
        }
        return;
      }

      // ── Single prompt mode ──────────────────────────────
      // v3.0.5: confirmation wiring. JSON mode: deny (unless --yolo), note
      // on stderr. Text mode on a TTY: interactive y/n/a prompt. Text mode
      // without a TTY: deny like JSON mode — never silently execute.
      if (app.permissionMode === 'ask') {
        if (jsonMode || !process.stdin.isTTY) {
          app.confirmHandler = async (req: ConfirmRequest) => {
            for (const line of req.message.split('\n').slice(0, 30)) {
              process.stderr.write(`  [confirm] ${line}\n`);
            }
            process.stderr.write('  [confirm] 已拒绝（headless 默认拒绝；加 --yolo 放行）\n');
            return false;
          };
        } else {
          const readline = await import('node:readline');
          const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
          app.confirmHandler = async (req: ConfirmRequest) => {
            process.stderr.write('\n');
            for (const line of req.message.split('\n').slice(0, 30)) {
              process.stderr.write(chalk.yellow(`  ⚠ ${line}`) + '\n');
            }
            const answer: string = await new Promise(resolve => {
              rl.question(chalk.cyan('  允许? [y/N/a(本会话全允许)]: '), resolve);
            });
            const a = answer.trim().toLowerCase();
            if (a === 'a') {
              app.setYolo(true);
              return true;
            }
            return a === 'y' || a === 'yes';
          };
        }
      }

      const abortCtrl = new AbortController();
      const onSigInt = () => { abortCtrl.abort(); };
      process.once('SIGINT', onSigInt);
      const showThinking = !!options.showThinking;

      const emit = (obj: any) => process.stdout.write(JSON.stringify(obj) + '\n');

      try {
        if (jsonMode) {
          emit({ type: 'start', prompt, provider: app.config.get().provider, model: app.config.get().model });
        } else {
          console.log(chalk.cyan.bold('\n  ⚡ THATGFSJ CODE\n'));
          console.log(chalk.gray('  You'));
          console.log(chalk.gray('  ' + '─'.repeat(40)));
          console.log('  ' + prompt);
          console.log();
          process.stdout.write(chalk.gray('  Thinking...'));
        }

        app.session.addMessage('user', prompt);
        let fullResponse = '';
        let lastUsage: any = null;

        const stream = app.streamResponse(undefined, { signal: abortCtrl.signal });

        for await (const chunk of stream) {
          if (abortCtrl.signal.aborted) break;

          switch (chunk.type) {
            case 'text': {
              if (chunk.content) {
                fullResponse += chunk.content;
                if (jsonMode) {
                  emit({ type: 'text', content: chunk.content });
                } else if (showThinking) {
                  process.stdout.write(chalk.cyan('  │ ') + chunk.content);
                }
              }
              break;
            }
            case 'thinking': {
              if (showThinking && chunk.content) {
                fullResponse += chunk.content;
                if (jsonMode) {
                  emit({ type: 'thinking', content: chunk.content });
                } else {
                  process.stdout.write(chalk.cyan('  │ ') + chunk.content);
                }
              }
              break;
            }
            case 'tool_calls': {
              // v3.0.16: `pending: true` is the TUI-only pre-execution
              // announcement. Headless keeps the original contract — exactly
              // ONE tool_calls event per agent round, emitted after execution
              // with results attached.
              if (chunk.pending) {
                break;
              }
              if (chunk.toolCalls && chunk.toolCalls.length > 0) {
                const results: ToolCallResult[] = chunk.results || [];
                if (jsonMode) {
                  emit({
                    type: 'tool_calls',
                    toolCalls: chunk.toolCalls.map(tc => ({
                      name: tc.function.name,
                      arguments: tc.function.arguments,
                    })),
                    results,
                  });
                } else {
                  for (const tc of chunk.toolCalls) {
                    console.log();
                    console.log(chalk.cyan(`  ⚙ ${tc.function.name}: ${formatArgs(tc.function.arguments)}`));
                    console.log(chalk.gray('  ' + '─'.repeat(40)));
                  }
                }
              }
              break;
            }
            case 'usage': {
              lastUsage = chunk.usage;
              if (jsonMode) {
                emit({ type: 'usage', usage: chunk.usage });
              } else {
                const u = chunk.usage;
                const hit = u.prompt_cache_hit_tokens || u.cache_read_input_tokens || 0;
                const miss = u.prompt_cache_miss_tokens || u.cache_creation_input_tokens || (u.prompt_tokens - hit);
                if (hit > 0 || miss > 0) {
                  const total = hit + miss;
                  const rate = total > 0 ? ((hit / total) * 100).toFixed(1) : '0.0';
                  console.log(chalk.gray(`  ⚡ cache: ${rate}% hit (${hit} / ${total} tokens)`));
                }
              }
              break;
            }
          }
        }

        if (!jsonMode) {
          // Post-process thinking blocks (see v2.2.5 notes): print the
          // cleaned conclusion when streaming was suppressed.
          if (!showThinking && !abortCtrl.signal.aborted && fullResponse) {
            const split = splitThinking(fullResponse);
            if (split.thinking) {
              const summary = summarizeThinking(split);
              if (summary) {
                console.log(chalk.gray(`  ${summary}`));
              }
              if (split.conclusion) {
                console.log(chalk.cyan('  │ ') + split.conclusion);
              }
            } else if (fullResponse.trim()) {
              console.log(chalk.cyan('  │ ') + fullResponse);
            }
          }
          console.log();
        }

        // Persist only on non-aborted rounds (v2.2.4 anti-hallucination rule).
        if (abortCtrl.signal.aborted) {
          if (jsonMode) {
            emit({ type: 'result', success: false, content: '', cancelled: true });
          } else {
            console.log(chalk.yellow('  ⏹  Cancelled (response not saved)'));
          }
          process.exitCode = 130;
        } else {
          const toPersist = showThinking
            ? fullResponse
            : compressThinking(fullResponse, false);
          const accepted = app.session.addMessageSafe('assistant', toPersist);
          if (!accepted && !jsonMode) {
            console.error(chalk.yellow(
              '  ⚠️  Dropped assistant message containing [已中断] marker.\n' +
              '      (prevents hallucination loop — try your question again)'
            ));
          }
          app.session.persist();

          app.session.persist();

          // v3.0.13: token-aware auto-compact (headless path).
          const compactNotice = app.maybeAutoCompact(lastUsage);
          if (compactNotice) {
            process.stderr.write(`\n  ${compactNotice}\n`);
          }

          if (jsonMode) {
            emit({ type: 'result', success: true, content: toPersist.trim() });
          }
        }
      } catch (error: any) {
        const msg = error.message || String(error);
        if (jsonMode) {
          emit({ type: 'error', message: msg });
        } else if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')) {
          console.error(chalk.red('\n  ❌ API key invalid or expired.'));
          console.log(chalk.gray('  Run ') + chalk.cyan('gfcode init') + chalk.gray(' to reconfigure.\n'));
        } else if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
          console.error(chalk.red('\n  ❌ Rate limit or quota exceeded.'));
          console.log(chalk.gray('  Wait or run ') + chalk.cyan('gfcode init') + chalk.gray(' to switch provider.\n'));
        } else if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
          console.error(chalk.red('\n  ❌ Cannot connect to API server.'));
          console.log(chalk.gray('  Check network or run ') + chalk.cyan('gfcode init') + chalk.gray('.\n'));
        } else {
          console.error(chalk.red(`\n  Error: ${msg}`));
        }
        process.exitCode = 1;
      } finally {
        process.removeListener('SIGINT', onSigInt);
      }
    } catch (error: any) {
      console.error(chalk.red(`\n  ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Configure API key and model')
  .action(async () => {
    ensureUtf8Console();
    await WelcomeScreen.interactiveSetup();
  });

program.parse(process.argv);

function formatArgs(args: string): string {
  try {
    const obj = JSON.parse(args);
    return Object.entries(obj)
      .map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 40 ? v.slice(0, 40) + '...' : JSON.stringify(v)}`)
      .join(' ');
  } catch {
    return args.length > 60 ? args.slice(0, 60) + '...' : args;
  }
}

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
import { reportCrash } from '../utils/crash.js';
import { getVersion } from '../version.js';
import { SessionManager } from '../session/index.js';
import { ConfigManager } from '../config/index.js';
import { MODEL_CATALOGS } from '../config/providers.js';
import { CacheStatsStore } from '../cache/stats.js';
import type { ConfirmRequest } from '../app/index.js';
import type { ChatResponse, ToolCallResult } from '../types.js';

process.on('uncaughtException', (error) => {
  reportCrash('uncaughtException', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  reportCrash('unhandledRejection', reason);
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
  .option('-m, --model <model>', 'Specify model (one-shot: this run only; with no prompt it becomes the default)')
  .option('-c, --continue', 'Continue the most recent session')
  .option('-i, --interactive', 'Force interactive mode')
  .option('--show-thinking', 'Show full <think>...</think> reasoning blocks (default: compress to one-line summary)')
  .option('--json', 'Headless JSON output: line-delimited events on stdout, human text on stderr')
  // v3.5.0: honest wording — read-only commands NEVER ask (v3.0.20 graded
  // approval); --yolo only removes the ask for write/execute actions.
  .option('--yolo', 'Auto-accept write/execute tool actions (read-only commands always run without asking)')
  .option('-t, --thinking <level>', 'Reasoning effort for thinking-capable models: off|low|medium|high')
  .action(async (prompt: string | undefined, options: {
    model?: string; interactive?: boolean; showThinking?: boolean; json?: boolean; yolo?: boolean; thinking?: string; continue?: boolean;
  }) => {
    try {
      const jsonMode = !!options.json;
      // v3.5.0: validate --thinking here (the option parser used to throw,
      // surfacing as an uncaughtException with a full Node stack).
      const thinkingLevels = ['off', 'low', 'medium', 'high'] as const;
      let thinking: 'off' | 'low' | 'medium' | 'high' | undefined;
      if (options.thinking !== undefined) {
        const t = options.thinking.toLowerCase();
        if (!thinkingLevels.includes(t as any)) {
          console.error(chalk.red(`\n  Error: --thinking 只接受 off | low | medium | high（收到 "${options.thinking}"）\n`));
          process.exit(1);
        }
        thinking = t as 'off' | 'low' | 'medium' | 'high';
      }
      if (!jsonMode && process.stdout.isTTY) {
        ensureUtf8Console();
      }

      const app = await App.create();
      app.setYolo(!!options.yolo);

      // v3.4.20 field report: -m/-t used to PERSIST through config.save(),
      // permanently poisoning later sessions (fake model, useBuiltin off).
      // One-shot runs now apply them in memory only; the interactive
      // launch path (no prompt) keeps the old persist-to-default behavior.
      const oneShot = !!prompt && !options.interactive;
      if (options.model) {
        if (oneShot) {
          app.config.setTransient({ model: options.model });
          await app.reloadModel();
        } else {
          await app.config.save({ model: options.model });
          await app.reloadModel();
        }
      }
      if (thinking) {
        await app.setModelThinking(app.config.get().model, thinking, !oneShot);
      }

      // v3.5.3 (field report C-3): -c used to load ONLY the newest file and
      // give up if that one was corrupt. Walk newest-first, take the first
      // session that parses, and say how many corrupt files were skipped.
      if (options.continue) {
        const candidates = SessionManager.list(10);
        if (candidates.length === 0) {
          console.error(chalk.yellow('\n  没有可恢复的会话（~/.thatgfsj/sessions/ 为空）。'));
          process.exit(1);
        }
        let file: ReturnType<typeof SessionManager.load> = null;
        let skipped = 0;
        for (const cand of candidates) {
          const f = SessionManager.load(cand.id);
          if (f && Array.isArray(f.messages)) { file = f; break; }
          skipped++;
        }
        if (!file) {
          console.error(chalk.red(`\n  最近 ${candidates.length} 个会话文件均无法读取（损坏或格式错误）。可删除损坏文件后重试。\n`));
          process.exit(1);
        }
        app.session.loadFrom(file);
        // v3.6.0 (P1-2): restored session — stale counters must not leak.
        app.resetSessionStats();
        if (!jsonMode) {
          console.log(chalk.gray(`  ↩ 已恢复会话 ${file.id}（${file.messages.length} 条消息）${skipped > 0 ? `（跳过 ${skipped} 个损坏文件）` : ''}`));
        }
      }

      // Check if API key is configured
      if (!app.config.hasApiKey()) {
        // v3.1.2: a built-in shared SiliconFlow model (Qwen/Qwen3.5-4B) ships
        // with the CLI, so a missing key no longer blocks startup — getAIConfig
        // falls back to it. Just tell the user; `gfcode init` configures a
        // personal key (and stops sharing the pooled quota).
        if (!jsonMode) {
          console.log(chalk.gray('  ℹ 未检测到 API Key，将使用内置共享模型 Qwen/Qwen3.5-4B（共享额度）。运行 gfcode init 配置自己的 key。'));
        } else {
          process.stderr.write('[builtin] using built-in shared model Qwen/Qwen3.5-4B (no API key configured)\n');
        }
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
        // Interactive mode - Ink TUI via Ink's NATIVE alternate screen
        // (v3.2.2): the whole UI renders inside the fixed viewport, and
        // signal-exit restores the main buffer on EVERY exit path —
        // including process.exit(1) from the error boundary, which the
        // old hand-rolled ?1049h/?1049l missed (left terminals garbled).
        const { render } = await import('ink');
        const { TuiApp } = await import('../tui/app.js');
        if (process.stdout.isTTY) {
          // Terminal window/tab title.
          process.stdout.write('\x1b]2;Thatgfsj\x07');
        }
        try {
          const { TuiErrorBoundary } = await import('../tui/components/ErrorBoundary.js');
          // v3.4.17: full-screen TUI (user mandate — opencode's three-zone
          // layout: left transcript+input, right info sidebar, all pinned).
          // Alternate screen: entering swaps buffers (clean start), exiting
          // restores the shell screen exactly — the 复原 the user asked for.
          // The wheel scrolls the transcript inside the app (↑/↓ on empty
          // input), native scrollback is not involved.
          const instance = render(
            <TuiErrorBoundary><TuiApp app={app} /></TuiErrorBoundary>,
            { alternateScreen: process.stdout.isTTY },
          );
          await instance.waitUntilExit();
        } finally {
          // Leave one blank line between the restored screen and the next prompt.
          if (process.stdout.isTTY) process.stdout.write('\r\n');
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
      let builtinCacheNoted = false;

      const emit = (obj: any) => process.stdout.write(JSON.stringify(obj) + '\n');

      try {
        if (jsonMode) {
          // v3.5.0: the session id rides on start so script consumers can
          // keep it and later resume with --continue.
          emit({ type: 'start', prompt, provider: app.config.get().provider, model: app.config.get().model, session: app.session.getId() });
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

        // v3.5.0: iterate manually so the generator's RETURN value (the
        // final ChatResponse with loopStats) is captured — the agent loop
        // can now abort early, and the result event must say so.
        const iterator = app.streamResponse(undefined, { signal: abortCtrl.signal });
        let next = await iterator.next();
        while (!next.done) {
          const chunk = next.value;
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
                // v3.5.0: the built-in shared model never reports cache
                // hits — printing "cache: 0.0% hit" every round read like
                // a broken promise. Say it once, honestly, instead.
                if (app.usingBuiltinModel) {
                  if (!builtinCacheNoted) {
                    builtinCacheNoted = true;
                    console.log(chalk.gray('  ⚡ 内置共享模型不启用 prompt 缓存；配置个人 key 后生效'));
                  }
                } else if (hit > 0 || miss > 0) {
                  const total = hit + miss;
                  const rate = total > 0 ? ((hit / total) * 100).toFixed(1) : '0.0';
                  console.log(chalk.gray(`  ⚡ cache: ${rate}% hit (${hit} / ${total} tokens)`));
                }
              }
              break;
            }
          }
          next = await iterator.next();
        }
        const finalResponse = next.done ? (next.value as ChatResponse | undefined) : undefined;
        const loopStats = finalResponse?.loopStats;
        const agentAborted = !!loopStats?.abortedReason;

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
          // v3.5.4 (field report P1): compact BEFORE persisting — the disk
          // session used to keep the UNCOMPRESSED history while the notice
          // claimed compaction, so `-c` resumed 18 stale messages.
          const compactNotice = app.maybeAutoCompact(lastUsage);
          app.session.persist();
          if (compactNotice) {
            process.stderr.write(`\n  ${compactNotice}\n`);
          }

          // v3.5.0: honest result semantics. The loop can now abort early
          // (all tool calls denied/failing, or maxIterations) — reporting
          // success:true for those made every headless consumer blind to
          // failure. success is false whenever the agent loop aborted, with
          // the reason and per-outcome counts attached.
          if (jsonMode) {
            if (toPersist.trim()) {
              emit({ type: 'text_final', content: toPersist.trim() });
            }
            const ok = !agentAborted;
            emit({
              type: 'result',
              success: ok,
              content: toPersist.trim(),
              // v3.5.3: explicit flag so consumers don't have to dig into
              // stats to detect an aborted loop.
              ...(ok ? {} : { aborted: true }),
              ...(loopStats ? { stats: { ...loopStats } } : {}),
            });
            if (!ok) {
              process.exitCode = 1;
              process.stderr.write(`\n  ⚠ 任务未完成：${loopStats?.abortedReason}\n`);
            }
          } else if (agentAborted) {
            process.stderr.write(chalk.yellow(`\n  ⚠ 任务未完成：${loopStats?.abortedReason}\n`));
            process.exitCode = 1;
          }
        }
      } catch (error: any) {
        const msg = error.message || String(error);
        // v3.5.3 (field report C-4): a failed round still holds real work
        // (user prompt + any completed tool rounds). Persist it — sanitized
        // on load — so `-c` can resume instead of losing everything.
        try { app.session.persist(); } catch { /* best-effort */ }
        if (jsonMode) {
          // v3.5.3: emit result (success:false) in ADDITION to the error
          // event — headless consumers had to handle two failure shapes
          // (result-with-false vs bare-error) depending on WHERE it broke.
          emit({ type: 'error', message: msg });
          emit({
            type: 'result',
            success: false,
            content: '',
            error: msg,
            // v3.5.4 (field report P2): consistent semantics — any
            // not-completed turn (provider error, stall, breaker) is
            // aborted:true so consumers check one field.
            aborted: true,
            stats: { rounds: 0, toolCalls: 0, denied: 0, failed: 0, abortedReason: msg },
          });
          process.exitCode = 1;
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
        // v3.5.4 (field report P0): connected MCP child stdio pipes kept the
        // event loop alive forever — the single-prompt process hung after a
        // perfectly successful result (240s kill to recover). Disconnecting
        // the servers lets the loop drain and the process exit normally.
        try { app.mcp.disconnectAll(); } catch { /* best-effort */ }
      }
    } catch (error: any) {
      console.error(chalk.red(`\n  ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Configure API key and model (interactive terminal required)')
  .action(async () => {
    // v3.5.0: same TTY guard as the main program — the wizard used to
    // render half a screen and hang on a pipe (field-report finding).
    if (!process.stdin.isTTY && !process.env.GFCODE_FORCE_TUI) {
      console.error(chalk.yellow('\n  gfcode init 需要交互式终端（TTY）才能打开配置向导。'));
      console.error(chalk.gray('  请在交互终端中直接运行: gfc init\n'));
      process.exit(1);
    }
    ensureUtf8Console();
    await WelcomeScreen.interactiveSetup();
  });

program
  .command('models')
  .description('List configured provider, current model, and catalog')
  .action(async () => {
    const config = await ConfigManager.load();
    const c = config.get();
    const pc = (await import('../config/providers.js')).PROVIDERS[c.provider];
    console.log(`provider:  ${c.provider}${pc ? ` (${pc.name})` : ''}`);
    console.log(`model:     ${c.model}${config.getAIConfig().usingBuiltinKey ? '  [内置共享模型]' : ''}`);
    console.log(`apiKey:    ${config.hasApiKey() ? '已配置' : '未配置（开箱将使用内置共享模型）'}`);
    const catalog = MODEL_CATALOGS[c.provider] || [];
    if (catalog.length > 0) {
      console.log(`catalog:   ${catalog.map(m => m.id).join(', ')}`);
    }
    if ((c.customModels || []).length > 0) {
      console.log(`custom:    ${c.customModels!.join(', ')}`);
    }
  });

program
  .command('usage')
  .description('Show lifetime token / prompt-cache statistics')
  .action(async () => {
    const store = new CacheStatsStore();
    const s = (store as any).stats || {};
    // v3.5.1: real field names (CacheStats) — the old guesses read
    // nonexistent keys and showed requests: 0 next to nonzero tokens.
    // Older stats files predate totalRequests; infer from history.
    const requests = s.totalRequests || (s.history ? s.history.length : 0) || 0;
    const input = s.totalInputTokens ?? 0;
    const cached = s.totalReadTokens ?? 0;
    const output = s.totalOutputTokens ?? 0;
    const rate = input > 0 ? ((cached / input) * 100).toFixed(1) : '0.0';
    console.log(`requests:      ${requests}`);
    console.log(`input tokens:  ${input}`);
    console.log(`cached tokens: ${cached} (${rate}% hit)`);
    console.log(`output tokens: ${output}`);
  });

program
  .command('mcp')
  .description('Show MCP server connection status (reads ~/.thatgfsj/mcp.json)')
  .action(async () => {
    const { App } = await import('../app/index.js');
    const app = await App.create();
    console.log(app.mcpStatusText());
    app.mcp.disconnectAll();
  });

// v3.5.0 (field report): a typo'd subcommand used to be swallowed as the
// prompt positional and burned a full LLM round ("gfc inti" → the model
// asking what the user means). Near-misses of real commands are stopped
// with a clean hint; anything else is a legitimate prompt.
const KNOWN_COMMANDS = ['init', 'models', 'usage', 'mcp'];

function levenshtein1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    // Adjacent transposition counts as one edit (init → inti).
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        diff++;
        if (diff > 2) return false;
      }
    }
    if (diff === 1) return true;
    if (diff === 2) {
      const i = a.split('').findIndex((ch, idx) => ch !== b[idx]);
      return a[i] === b[i + 1] && a[i + 1] === b[i];
    }
    return false;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < long.length; i++) {
    if (long.slice(0, i) + long.slice(i + 1) === short) return true;
  }
  return false;
}

const firstArg = process.argv[2];
if (firstArg && !firstArg.startsWith('-')) {
  const lower = firstArg.toLowerCase();
  if (!KNOWN_COMMANDS.includes(lower)) {
    const near = KNOWN_COMMANDS.find(k => levenshtein1(k, lower));
    if (near) {
      console.error(chalk.red(`\n  未知命令 "${firstArg}" —— 你是想执行 "gfc ${near}" 吗？`));
      console.error(chalk.gray(`  如果 "${firstArg}" 是要发送给 AI 的任务，请加引号: gfc "${firstArg}"\n`));
      process.exit(1);
    }
  }
}

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

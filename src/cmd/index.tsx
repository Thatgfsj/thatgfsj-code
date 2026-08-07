#!/usr/bin/env node

/**
 * Thatgfsj Code - CLI Entry Point
 *
 * v2.2.4 (product 0.4.1): three concrete fixes for the bugs visible
 * in the 2.2.3 (product 0.4.0) session log:
 *
 *   1. Encoding: chcp 65001 used to be wrapped in a silent try/catch,
 *      and stdout never had its default encoding set. On Windows this
 *      caused Chinese characters from tool output to render as
 *      mojibake (ļ ʹ ϵͳ Ƿ ...).
 *
 *   2. [已中断] hallucination loop: 1.0.4's SessionManager had no
 *      anti-pollution filter. When the user pressed Ctrl+C mid-
 *      stream, the truncated assistant message (containing the
 *      model's literal "[已中断]" marker) got persisted to history.
 *      On the next turn, the model saw that and kept echoing it.
 *      v2.1.0 had the right fix (_wasAborted flag + filter) — we
 *      port it back here.
 *
 *   3. Tool output visual: 1.0.4 printed `@@TOOL@@{...}` markers
 *      inline with text, no separator, no truncation. Long tool
 *      output (registry dumps, dir listings) bled into the next
 *      AI message. Add separator + truncation + color separation.
 */

if (process.platform === 'win32') {
  // Switch Windows console to UTF-8 BEFORE any other code runs.
  // v2.2.3 wrapped this in `try { } catch {}` which silently swallowed
  // failures (e.g. when running under a non-interactive shell where
  // chcp is meaningless). Now we still try, but we also fall back to
  // setting the codepage via the parent process's stdio handles.
  try {
    require('child_process').execSync('chcp 65001 >NUL', { stdio: 'ignore', windowsHide: true });
  } catch {
    // Non-Windows shell, or chcp unavailable (e.g. git-bash on CI) —
    // that's fine, Node defaults to UTF-8 in that environment.
  }
}

// Force stdout/stderr to UTF-8 regardless of platform. Without this,
// Node will emit GBK-encoded bytes for non-ASCII characters on
// Windows even after `chcp 65001`, because the underlying file
// descriptors still report a non-UTF-8 code page.
if (process.stdout.setDefaultEncoding) {
  process.stdout.setDefaultEncoding('utf8');
}
if (process.stderr.setDefaultEncoding) {
  process.stderr.setDefaultEncoding('utf8');
}

import { program } from 'commander';
import chalk from 'chalk';
import { App } from '../app/index.js';
import { WelcomeScreen } from '../tui/welcome.js';
import { compressThinking, summarizeThinking, splitThinking } from '../utils/thinking.js';

process.on('uncaughtException', (error) => {
  console.error(chalk.red('\n  Error:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('\n  Error:'), reason);
  process.exit(1);
});

program
  .name('gfcode')
  .description('Thatgfsj Code - AI Coding Assistant')
  .version('0.5.0')
  .argument('[prompt]', 'Task to execute (omit to start interactive mode)')
  .option('-m, --model <model>', 'Specify model')
  .option('-i, --interactive', 'Force interactive mode')
  .option('--show-thinking', 'Show full <think>...</think> reasoning blocks (default: compress to one-line summary)')
  .action(async (prompt: string | undefined, options: { model?: string; interactive?: boolean; showThinking?: boolean }) => {
    try {
      const app = await App.create();

      // Check if API key is configured
      if (!app.config.hasApiKey()) {
        console.log(chalk.yellow('\n  ⚠  No API key configured\n'));
        console.log(chalk.gray('  Run ') + chalk.cyan('gfcode init') + chalk.gray(' to set up your provider.\n'));
        const readline = await import('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>(resolve => {
          rl.question(chalk.cyan('  Run init now? (Y/n): '), resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== 'n') {
          await WelcomeScreen.interactiveSetup();
          // Reload config after setup
          const newApp = await App.create();
          Object.assign(app, newApp);
        } else {
          process.exit(0);
        }
      }

      if (options.model) {
        await app.config.save({ model: options.model });
      }

      if (!prompt || options.interactive) {
        // Interactive mode - Ink TUI
        const { render } = await import('ink');
        const { TuiApp } = await import('../tui/app.js');
        const { unmount } = render(<TuiApp app={app} />);
        await new Promise<void>((resolve) => {
          process.on('exit', () => { unmount(); resolve(); });
        });
      } else {
        // Single prompt mode
        console.log(chalk.cyan.bold('\n  ⚡ THATGFSJ CODE\n'));
        console.log(chalk.gray('  You'));
        console.log(chalk.gray('  ' + '─'.repeat(40)));
        console.log('  ' + prompt);
        console.log();

        app.session.addMessage('user', prompt);
        let fullResponse = '';
        // v2.2.4: track whether the stream was aborted so we don't
        // persist a truncated assistant message (which is what caused
        // the [已中断] hallucination loop in v2.2.3).
        const abortCtrl = new AbortController();
        const onSigInt = () => { abortCtrl.abort(); };
        process.once('SIGINT', onSigInt);
        // v2.2.5 (product 0.4.2): compress <think> blocks at render time
        // AND before persisting to history. Without this, every assistant
        // message balloons history with reasoning the user has already
        // seen compressed, and context windows blow up fast.
        const showThinking = !!options.showThinking;

        try {
          process.stdout.write(chalk.gray('  Thinking...'));
          const stream = app.streamResponse();

          // v3.0.0: stream is now AsyncGenerator<StreamChunk> instead of
          // string. Tool calls come as { type: 'tool_calls', toolCalls }
          // with structured args; usage comes as { type: 'usage', usage }
          // at end. We render text live, render tool dispatches inline, and
          // capture the final response text into fullResponse for the
          // post-process step below.
          for await (const chunk of stream) {
            if (abortCtrl.signal.aborted) break;
            // Clear the entire "Thinking..." line — must use enough
            // spaces to overwrite any longer thinking indicator.
            process.stdout.write('\r' + ' '.repeat(80) + '\r');

            switch (chunk.type) {
              case 'text': {
                if (chunk.content) {
                  fullResponse += chunk.content;
                  // Show the chunk as it streams, but we'll re-render the
                  // final compressed version below. To avoid double-
                  // printing, only echo when we're NOT going to post-
                  // process (i.e., when showThinking is true and we want
                  // to see everything live).
                  if (showThinking) {
                    process.stdout.write(chalk.cyan('  │ ') + chunk.content);
                  }
                }
                break;
              }
              case 'thinking': {
                // Reasoning content. Strip from persisted content via
                // compressThinking; show live if user asked for it.
                if (showThinking && chunk.content) {
                  fullResponse += chunk.content;
                  process.stdout.write(chalk.cyan('  │ ') + chunk.content);
                }
                break;
              }
              case 'tool_calls': {
                if (chunk.toolCalls && chunk.toolCalls.length > 0) {
                  for (const tc of chunk.toolCalls) {
                    console.log();
                    console.log(chalk.cyan(`  ⚙ ${tc.function.name}: ${formatArgs(tc.function.arguments)}`));
                    console.log(chalk.gray('  ' + '─'.repeat(40)));
                  }
                }
                break;
              }
              case 'usage': {
                // v3.0.0: surface cache stats at the end of single-prompt
                // mode so CLI users can see hit-rate without /cache command.
                const u = chunk.usage;
                const hit = u.prompt_cache_hit_tokens || u.cache_read_input_tokens || 0;
                const miss = u.prompt_cache_miss_tokens || u.cache_creation_input_tokens || (u.prompt_tokens - hit);
                if (hit > 0 || miss > 0) {
                  const total = hit + miss;
                  const rate = total > 0 ? ((hit / total) * 100).toFixed(1) : '0.0';
                  console.log(chalk.gray(`  ⚡ cache: ${rate}% hit (${hit} / ${total} tokens)`));
                }
                break;
              }
            }
          }

          // v2.2.5: post-process. Strip <think> blocks, summarize,
          // and print the cleaned conclusion if we suppressed it
          // during streaming.
          if (!showThinking && !abortCtrl.signal.aborted && fullResponse) {
            const split = splitThinking(fullResponse);
            if (split.thinking) {
              // Clear what we already streamed (we suppressed text
              // chunks during streaming, so there's nothing to clear
              // unless showThinking was on; in that case the text
              // already contains the <think> block live and there's
              // no point double-printing).
              const summary = summarizeThinking(split);
              if (summary) {
                console.log(chalk.gray(`  ${summary}`));
              }
              if (split.conclusion) {
                console.log(chalk.cyan('  │ ') + split.conclusion);
              }
            } else if (fullResponse.trim()) {
              // No thinking block found — print the conclusion if we
              // hadn't already (showThinking=false suppresses
              // streaming text).
              console.log(chalk.cyan('  │ ') + fullResponse);
            }
          }

          console.log();
          // v2.2.4: skip persistence on abort.
          if (!abortCtrl.signal.aborted) {
            // v2.2.5: persist only the conclusion (no <think> blocks)
            // when compression is enabled. This keeps the conversation
            // log readable AND keeps context-window usage low.
            const toPersist = showThinking
              ? fullResponse
              : compressThinking(fullResponse, false);
            const accepted = app.session.addMessageSafe('assistant', toPersist);
            if (!accepted) {
              console.error(chalk.yellow(
                '  ⚠️  Dropped assistant message containing [已中断] marker.\n' +
                '      (prevents hallucination loop — try your question again)'
              ));
            }
          } else {
            console.log(chalk.yellow('  ⏹  Cancelled (response not saved)'));
          }
        } catch (error: any) {
          const msg = error.message || String(error);
          if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')) {
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
        } finally {
          process.removeListener('SIGINT', onSigInt);
        }
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

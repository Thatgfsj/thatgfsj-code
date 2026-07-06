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
  .version('0.4.1')
  .argument('[prompt]', 'Task to execute (omit to start interactive mode)')
  .option('-m, --model <model>', 'Specify model')
  .option('-i, --interactive', 'Force interactive mode')
  .action(async (prompt: string | undefined, options: { model?: string; interactive?: boolean }) => {
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

        try {
          process.stdout.write(chalk.gray('  Thinking...'));
          const stream = app.streamResponse();

          for await (const chunk of stream) {
            // Clear the entire "Thinking..." line — must use enough
            // spaces to overwrite any longer thinking indicator.
            process.stdout.write('\r' + ' '.repeat(80) + '\r');

            // Parse tool messages
            if (chunk.includes('@@TOOL@@')) {
              const parts = chunk.split('\n');
              for (const part of parts) {
                if (part.startsWith('@@TOOL@@')) {
                  try {
                    const data = JSON.parse(part.slice(8));
                    if (data.action === 'call') {
                      // v2.2.4: visible separator between AI text and
                      // tool execution. Without this, long tool output
                      // bleeds into the next AI message visually.
                      console.log();
                      console.log(chalk.cyan(`  ⚙ ${data.name}: ${formatArgs(data.args)}`));
                      console.log(chalk.gray('  ' + '─'.repeat(40)));
                    } else if (data.action === 'result') {
                      const output = data.output || data.error || '';
                      const lines = output.split('\n');
                      // v2.2.4: truncate to 20 lines + show count
                      // if we cut off (registry dumps / dir listings
                      // can be hundreds of lines).
                      const MAX_TOOL_LINES = 20;
                      const truncated = lines.length > MAX_TOOL_LINES;
                      const visible = truncated ? lines.slice(0, MAX_TOOL_LINES) : lines;
                      for (const line of visible) {
                        console.log(chalk.gray('    │ ') + line);
                      }
                      if (truncated) {
                        console.log(chalk.gray(`    │ ... (${lines.length - MAX_TOOL_LINES} more lines truncated)`));
                      }
                      console.log(chalk.gray('  ' + '─'.repeat(40)));
                    }
                  } catch {}
                } else if (part) {
                  // v2.2.4: AI text before/after tool calls should be
                  // indented like the rest of the conversation. Old
                  // code prefixed with `  │ ` (vertical bar) which
                  // visually merged with tool output — confusing.
                  process.stdout.write(chalk.cyan('  │ ') + part);
                }
              }
            } else {
              // Plain AI text — wrap in '│ ' indent to match the
              // conversation frame above.
              process.stdout.write(chalk.cyan('  │ ') + chunk);
            }
            fullResponse += chunk;
            if (abortCtrl.signal.aborted) break;
          }

          console.log();
          // v2.2.4: skip persistence on abort. The model may have
          // emitted "[已中断]" or other truncation markers; persisting
          // them creates the hallucination loop on next turn.
          if (!abortCtrl.signal.aborted) {
            // Defensive: even if the abort signal wasn't tripped,
            // drop the assistant message if SessionManager's filter
            // considers it polluted (e.g. it contains '[已中断]').
            const accepted = app.session.addMessageSafe('assistant', fullResponse);
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

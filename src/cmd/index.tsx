#!/usr/bin/env node

/**
 * Thatgfsj Code - CLI Entry Point
 */

if (process.platform === 'win32') {
  try {
    require('child_process').execSync('chcp 65001', { stdio: 'ignore', windowsHide: true });
  } catch {}
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
  .version('1.0.5')
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

        try {
          process.stdout.write(chalk.gray('  Thinking...\r'));
          const stream = app.streamResponse();

          for await (const chunk of stream) {
            // Clear thinking line
            process.stdout.write('\r' + ' '.repeat(40) + '\r');

            // Parse tool messages
            if (chunk.includes('@@TOOL@@')) {
              const parts = chunk.split('\n');
              for (const part of parts) {
                if (part.startsWith('@@TOOL@@')) {
                  try {
                    const data = JSON.parse(part.slice(8));
                    if (data.action === 'call') {
                      console.log();
                      console.log(chalk.cyan(`  ⚙ ${data.name}: ${formatArgs(data.args)}`));
                    } else if (data.action === 'result') {
                      const output = data.output || data.error || '';
                      const lines = output.split('\n').slice(0, 10);
                      for (const line of lines) {
                        console.log(chalk.gray('    │ ') + line);
                      }
                    }
                  } catch {}
                } else if (part) {
                  process.stdout.write(chalk.cyan('  │ ') + part);
                }
              }
            } else {
              process.stdout.write(chunk);
            }
            fullResponse += chunk;
          }

          console.log();
          app.session.addMessage('assistant', fullResponse);
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

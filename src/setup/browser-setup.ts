/**
 * First-run browser setup (v3.0.14).
 *
 * On the first interactive run we ask whether to install the Playwright
 * browser service. Choosing yes downloads the BUNDLED Chromium (~130MB) —
 * the user's own Edge/Chrome is never touched or launched. The outcome is
 * persisted so the question never repeats.
 *
 * Non-interactive environments (piped stdin, --json) skip silently.
 */

import chalk from 'chalk';
import { execSync } from 'child_process';
import type { ConfigManager } from '../config/index.js';
import { BrowserTool } from '../tools/browser.js';

export async function ensureBrowserSetup(config: ConfigManager): Promise<void> {
  const c = config.get() as any;
  if (c.browserSetup?.done) return;
  if (!process.stdin.isTTY) return; // headless: skip silently, never prompt

  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>(res => rl.question(q, a => res(a.trim())));

  console.log();
  console.log(chalk.bold('  浏览器服务（Playwright）'));
  console.log(chalk.gray('  安装后 AI 能用内置浏览器搜索网页、读取页面内容（独立运行，不影响你的浏览器）。'));

  try {
    const answer = await ask(chalk.cyan('  是否安装？将下载内置 Chromium（约 130MB，一次性）[y/N] '));
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      console.log(chalk.gray('  正在下载 Chromium（一次性，可能需要几分钟）…'));
      try {
        execSync('npx -y playwright install chromium', { stdio: 'inherit', timeout: 15 * 60 * 1000 });
        const mode = await BrowserTool.verifyLaunch();
        if (mode) {
          await config.save({ browserSetup: { done: true, mode } });
          console.log(chalk.green('  ✓ Chromium 安装完成，浏览器工具已就绪。'));
        } else {
          await config.save({ browserSetup: { done: true, mode: 'declined' } });
          console.log(chalk.yellow('  ⚠ 安装完成但浏览器无法启动，稍后可重试。'));
        }
      } catch {
        await config.save({ browserSetup: { done: true, mode: 'declined' } });
        console.log(chalk.yellow('  ⚠ 下载失败。浏览器工具暂不可用，重新运行 gfcode 可再试。'));
      }
    } else {
      await config.save({ browserSetup: { done: true, mode: 'declined' } });
      console.log(chalk.gray('  已跳过。之后想启用：删除 ~/.thatgfsj/config.json 里的 browserSetup 再运行 gfcode。'));
    }
  } catch {
    // setup must never block startup
    try { await config.save({ browserSetup: { done: true, mode: 'declined' } }); } catch { /* ignore */ }
  } finally {
    rl.close();
  }
}

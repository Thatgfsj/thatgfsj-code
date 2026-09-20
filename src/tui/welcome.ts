/**
 * Welcome / Setup Wizard - Clean UI
 */

import chalk from 'chalk';
// v3.0.5: `readline` (bare) resolves to a deprecated placeholder package on
// npm that shadows Node's builtin — use the explicit node: builtin.
import readline from 'node:readline';
import { join } from 'path';
import { homedir } from 'os';
import { PROVIDERS, getModelsForProvider, listProviders, isCustomProvider } from '../config/providers.js';
import type { ProviderName } from '../config/types.js';
import { getVersion } from '../version.js';

const line = chalk.gray('─'.repeat(52));

export class WelcomeScreen {

  static show(hasApiKey: boolean): void {
    if (hasApiKey) return;

    console.log();
    console.log(chalk.hex('#FF8C42')('  ◆ ') + chalk.bold('gfcode') + chalk.gray(` v${getVersion()}`));
    console.log(chalk.gray('  AI 编程助手 · 终端里的 AI 编程伙伴'));
    console.log(line);
    console.log();
    console.log(chalk.yellow('  ⚠  尚未配置 API Key'));
    console.log();
    console.log(chalk.gray('  运行 ') + chalk.cyan.bold('gfcode init') + chalk.gray(' 选择服务商并配置。'));
    console.log();
    console.log(chalk.gray('  支持: OpenAI · Claude · DeepSeek · Kimi · GLM · Gemini · 硅基流动 · 中转站'));
    console.log(line);
    console.log();
  }

  static async interactiveSetup(): Promise<void> {
    console.clear();
    console.log();
    console.log(chalk.cyan.bold('  ⚡ Thatgfsj Code') + chalk.gray(' - Setup'));
    console.log(line);
    console.log();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const ask = (prompt: string): Promise<string> =>
      new Promise(resolve => rl.question(prompt, answer => resolve(answer.trim())));

    try {
      // ── Step 1: Provider ────────────────────────────────
      console.log(chalk.bold('  1. Choose Provider'));
      console.log();
      const providers = listProviders();
      providers.forEach((p, i) => {
        const num = chalk.cyan((i + 1).toString().padStart(2));
        console.log(`    ${num}  ${p.name}`);
      });
      console.log();

      const choice = await ask(chalk.cyan('    ❯ '));
      const selected = providers[parseInt(choice) - 1] || providers[0];
      const providerName = selected.key;

      // ── Step 2: API Key ─────────────────────────────────
      console.log();
      console.log(chalk.bold('  2. API Key'));
      console.log();

      let baseUrl: string | undefined;

      if (isCustomProvider(providerName)) {
        console.log(chalk.yellow('    Custom Provider (Relay Station)'));
        console.log(chalk.gray('    OpenAI-compatible or Anthropic-compatible'));
        console.log();
        baseUrl = await ask(chalk.cyan('    Base URL ❯ '));
        if (!baseUrl) {
          console.log(chalk.red('    ❌ Base URL required'));
          rl.close();
          return;
        }
        baseUrl = baseUrl.replace(/\/+$/, '');
      }

      const apiKey = await ask(chalk.cyan('    API Key ❯ '));

      // ── Step 3: Model ───────────────────────────────────
      console.log();
      console.log(chalk.bold('  3. Choose Model'));
      console.log();

      let model: string;
      if (isCustomProvider(providerName)) {
        console.log(chalk.gray('    Enter model name for your relay station'));
        console.log(chalk.gray('    e.g. gpt-4o-mini, claude-sonnet-4-20250514'));
        console.log();
        model = await ask(chalk.cyan('    Model ❯ '));
        if (!model) {
          console.log(chalk.red('    ❌ Model name required'));
          rl.close();
          return;
        }
      } else {
        const models = getModelsForProvider(providerName);
        models.forEach((m, i) => {
          const num = chalk.cyan((i + 1).toString().padStart(2));
          console.log(`    ${num}  ${chalk.white(m.name)}  ${chalk.gray(m.desc)}`);
        });
        console.log();
        const modelChoice = await ask(chalk.cyan('    ❯ '));
        const selectedModel = models[parseInt(modelChoice) - 1] || models[0];
        model = selectedModel.id;
      }

      // ── Step 4: Context Length ───────────────────────────
      console.log();
      console.log(chalk.bold('  4. Context Length'));
      console.log();
      console.log(chalk.gray('    Max messages kept in conversation history'));
      console.log(chalk.gray('    Higher = more context, more tokens used'));
      console.log();
      console.log(chalk.cyan('    1') + '  20  ' + chalk.gray('(short,节省 token)'));
      console.log(chalk.cyan('    2') + '  50  ' + chalk.gray('(default,推荐)'));
      console.log(chalk.cyan('    3') + '  100 ' + chalk.gray('(long,长对话)'));
      console.log(chalk.cyan('    4') + '  200 ' + chalk.gray('(very long,超长对话)'));
      console.log();
      const ctxChoice = await ask(chalk.cyan('    ❯ '));
      const ctxMap: Record<string, number> = { '1': 20, '2': 50, '3': 100, '4': 200 };
      const contextLength = ctxMap[ctxChoice] || 50;

      // ── Save ────────────────────────────────────────────
      // v3.4.2: through ConfigManager — the old private saveConfig() wrote
      // a bare 5-field object (no cache key, non-atomic, wiping any
      // modelSettings/customModels the file already had). A load+save round
      // keeps the merge/atomic-write semantics of every other writer.
      const { ConfigManager } = await import('../config/index.js');
      const cm = await ConfigManager.load();
      await cm.save({
        provider: providerName,
        model,
        apiKey,
        baseUrl,
        contextLength,
      });

      // ── Done ────────────────────────────────────────────
      console.log();
      console.log(line);
      console.log(chalk.green.bold('  ✅ Configuration saved!'));
      console.log();
      console.log(chalk.gray('  Config: ') + chalk.white(join(homedir(), '.thatgfsj', 'config.json')));
      console.log(chalk.gray('  Run ') + chalk.cyan.bold('gfcode') + chalk.gray(' to start.'));
      console.log(line);
      console.log();

    } finally {
      rl.close();
    }
  }
}

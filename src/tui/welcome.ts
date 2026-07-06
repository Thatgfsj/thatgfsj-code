/**
 * Welcome / Setup Wizard - Clean UI
 */

import chalk from 'chalk';
import readline from 'readline';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { PROVIDERS, getModelsForProvider, listProviders, isCustomProvider } from '../config/providers.js';
import { PRODUCT_VERSION_DISPLAY } from '../version.js';
import type { ProviderName } from '../config/types.js';

const line = chalk.gray('─'.repeat(52));

export class WelcomeScreen {

  static show(hasApiKey: boolean): void {
    if (hasApiKey) return;

    console.log();
    console.log(chalk.cyan.bold('  ⚡ Thatgfsj Code') + chalk.gray(' ' + PRODUCT_VERSION_DISPLAY));
    console.log(chalk.gray('  AI Coding Assistant'));
    console.log(line);
    console.log();
    console.log(chalk.yellow('  ⚠  No API key configured'));
    console.log();
    console.log(chalk.gray('  Run ') + chalk.cyan.bold('gfcode init') + chalk.gray(' to set up your provider.'));
    console.log();
    console.log(chalk.gray('  Supported providers:'));
    console.log(chalk.gray('  OpenAI · Claude · DeepSeek · Kimi · GLM · Gemini · 中转站'));
    console.log(line);
    console.log();
  }

  static async interactiveSetup(): Promise<void> {
    console.clear();
    console.log();
    console.log(chalk.cyan.bold('  ⚡ Thatgfsj Code') + chalk.gray(' ' + PRODUCT_VERSION_DISPLAY + ' - Setup'));
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
      this.saveConfig(providerName, model, apiKey, baseUrl, contextLength);

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

  private static saveConfig(provider: ProviderName, model: string, apiKey: string, baseUrl?: string, contextLength = 50): void {
    const configDir = join(homedir(), '.thatgfsj');
    const configPath = join(configDir, 'config.json');

    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    const config: Record<string, any> = {
      provider,
      model,
      apiKey,
      temperature: 0.7,
      maxTokens: 4096,
      contextLength,
    };

    if (baseUrl) config.baseUrl = baseUrl;

    writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log();
    console.log(chalk.gray('    Provider: ') + chalk.white(provider));
    console.log(chalk.gray('    Model:    ') + chalk.white(model));
    if (baseUrl) {
      console.log(chalk.gray('    URL:      ') + chalk.white(baseUrl));
    }
  }
}

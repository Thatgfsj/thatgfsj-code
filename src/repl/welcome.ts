/**
 * Welcome Screen - Claude Code 风格
 */

import chalk from 'chalk';
import readline from 'readline';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface ModelInfo {
  id: string;
  name: string;
  desc: string;
}

export class WelcomeScreen {

  // SiliconFlow 推荐模型列表 (2026-01 cutoff)
  // API: OpenAI 兼容 — https://api.siliconflow.cn/v1/chat/completions
  static readonly SILICONFLOW_MODELS: ModelInfo[] = [
    { id: 'Qwen/Qwen3-235B-A22B-Instruct-2507', name: 'Qwen3-235B (推荐)', desc: '最新旗舰,综合能力强' },
    { id: 'Qwen/Qwen3-32B',                   name: 'Qwen3-32B',        desc: '性价比高,日常编程' },
    { id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct', name: 'Qwen3-Coder-480B', desc: '代码专用,最强' },
    { id: 'Qwen/Qwen3-Coder-30B-A3B-Instruct', name: 'Qwen3-Coder-30B',  desc: '代码专用,性价比' },
    { id: 'Qwen/Qwen2.5-72B-Instruct',         name: 'Qwen2.5-72B',      desc: '上一代旗舰' },
    { id: 'Pro/moonshotai/Kimi-K2-Instruct',   name: 'Kimi-K2',          desc: 'Moonshot 200B 长上下文' },
    { id: 'Pro/deepseek-ai/DeepSeek-V3.2',     name: 'DeepSeek-V3.2',    desc: '深度求索最新' },
    { id: 'Pro/deepseek-ai/DeepSeek-R1',       name: 'DeepSeek-R1',      desc: '强推理,适合复杂调试' },
    { id: 'THUDM/glm-4-9b-chat',               name: 'GLM-4-9B',         desc: '智谱 9B 轻量' },
    { id: 'baidu/ERNIE-4.5-300B-A47B',         name: 'ERNIE-4.5',        desc: '百度文心旗舰' },
  ];

  // MiniMax 模型 (Anthropic API 兼容)
  static readonly MINIMAX_MODELS = [
    { id: 'MiniMax-M3',          name: 'MiniMax-M3 (推荐)',    desc: '代号 M3,2026 默认模型' },
    { id: 'MiniMax-M2.5',        name: 'MiniMax-M2.5',         desc: '上一代旗舰' },
    { id: 'MiniMax-M2.1',        name: 'MiniMax-M2.1',         desc: '稳定版本' },
  ];

  // OpenAI 模型
  static readonly OPENAI_MODELS = [
    { id: 'gpt-4.1-mini',            name: 'GPT-4.1-mini (推荐)', desc: '性价比最高' },
    { id: 'gpt-4.1',                 name: 'GPT-4.1',             desc: '最新通用旗舰' },
    { id: 'gpt-4o',                  name: 'GPT-4o',              desc: '多模态旗舰' },
    { id: 'o4-mini',                 name: 'o4-mini',             desc: '推理加强' },
    { id: 'gpt-5',                   name: 'GPT-5',               desc: '下一代旗舰(若可用)' },
  ];

  // Anthropic 模型
  static readonly ANTHROPIC_MODELS = [
    { id: 'claude-haiku-4-5-20251001', name: 'Claude-Haiku-4.5 (推荐)', desc: '快速响应,Agent 友好' },
    { id: 'claude-sonnet-4-5-20251001', name: 'Claude-Sonnet-4.5',       desc: '主力旗舰' },
    { id: 'claude-opus-4-1-20251001',  name: 'Claude-Opus-4.1',          desc: '最强推理' },
  ];

  // Gemini 模型
  static readonly GEMINI_MODELS = [
    { id: 'gemini-2.5-flash',   name: 'Gemini-2.5-Flash (推荐)', desc: '免费快速' },
    { id: 'gemini-2.5-pro',     name: 'Gemini-2.5-Pro',          desc: '最新旗舰' },
    { id: 'gemini-2.0-flash',   name: 'Gemini-2.0-Flash',        desc: '上一代快速' },
  ];

  // Kimi 模型 (Moonshot AI)
  static readonly KIMI_MODELS = [
    { id: 'moonshot-v1-128k',     name: 'Moonshot-V1-128K (推荐)', desc: '超长上下文' },
    { id: 'moonshot-v1-32k',      name: 'Moonshot-V1-32K',         desc: '日常编程' },
    { id: 'kimi-k2-instruct',     name: 'Kimi-K2',                 desc: '最新 200B MoE' },
  ];

  // DeepSeek 模型
  static readonly DEEPSEEK_MODELS = [
    { id: 'deepseek-chat',     name: 'DeepSeek-V3 (推荐)', desc: '日常编程,性价比高' },
    { id: 'deepseek-coder',    name: 'DeepSeek-Coder',      desc: '编程专用' },
    { id: 'deepseek-reasoner', name: 'DeepSeek-R1',         desc: '强推理' },
  ];

  // ERNIE 模型 (百度文心一言)
  static readonly ERNIE_MODELS = [
    { id: 'ernie-4.5-8k',     name: 'ERNIE-4.5-8K (推荐)', desc: '百度最新旗舰' },
    { id: 'ernie-4.0-8k',     name: 'ERNIE-4.0-8K',        desc: '上一代旗舰' },
  ];

  /**
   * Get models for a specific provider
   */
  static getModelsForProvider(provider: string): ModelInfo[] {
    switch (provider) {
      case 'siliconflow':
        return this.SILICONFLOW_MODELS;
      case 'minimax':
        return this.MINIMAX_MODELS;
      case 'openai':
        return this.OPENAI_MODELS;
      case 'anthropic':
        return this.ANTHROPIC_MODELS;
      case 'gemini':
        return this.GEMINI_MODELS;
      case 'kimi':
        return this.KIMI_MODELS;
      case 'deepseek':
        return this.DEEPSEEK_MODELS;
      case 'ernie':
        return this.ERNIE_MODELS;
      default:
        return this.SILICONFLOW_MODELS;
    }
  }

  /**
   * Check if API key exists (updated for all providers)
   */
  static hasApiKey(): boolean {
    if (process.env.SILICONFLOW_API_KEY || 
        process.env.OPENAI_API_KEY || 
        process.env.MINIMAX_API_KEY ||
        process.env.ANTHROPIC_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.KIMI_API_KEY ||
        process.env.MOONSHOT_API_KEY ||
        process.env.DEEPSEEK_API_KEY ||
        process.env.OLLAMA_BASE_URL) {
      return true;
    }
    
    const configPath = join(homedir(), '.thatgfsj', 'config.json');
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        return !!(config.apiKey);
      } catch {
        return false;
      }
    }
    
    return false;
  }

  /**
   * 如果没有 API Key 则显示欢迎页
   */
  static show(): boolean {
    if (this.hasApiKey()) {
      return false;
    }

    this.printClaudeStyle();
    return true;
  }

  /**
   * Claude Code 风格欢迎页
   */
  static printClaudeStyle(): void {
    console.clear();
    
    const w = 62;
    
    console.log(chalk.cyan('+') + chalk.white.bold(' Thatgfsj Code ') + chalk.cyan('-'.repeat(w - 17)) + '+');
    console.log(chalk.cyan('|') + chalk.yellow(' 快速开始指南').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray(' 欢迎使用 Thatgfsj Code!').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray(' 运行 gfcode init 配置你的 API Key').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));
    
    console.log(chalk.cyan('|') + chalk.green(' 可用提供商:').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray('  - SiliconFlow (推荐) - Qwen, Kimi, DeepSeek').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray('  - MiniMax - Moonshot Kimi 系列').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray('  - OpenAI - GPT-4o, GPT-4o-mini').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray('  - Anthropic - Claude 3.5 Sonnet').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));
    
    console.log(chalk.cyan('|') + chalk.cyan(' 快捷命令:').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray('   gfcode init        - 配置 API Key').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray('   gfcode "问题"     - 提问').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray('   gfcode            - 交互模式').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));
    
    const model = process.env.MODEL || '未配置';
    const cwd = process.cwd().length > 38 ? '...' + process.cwd().slice(-35) : process.cwd();
    console.log(chalk.cyan('|') + chalk.gray(' 当前模型: ' + model).padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray(' 工作目录: ' + cwd).padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('+') + '-'.repeat(w) + '+');
    console.log();
    console.log(chalk.gray(' 输入 "help" 查看快捷命令'));
    console.log();
  }

  /**
   * 交互式配置向导 - 带模型选择 (支持所有 Provider)
   */
  static async interactiveSetup(): Promise<void> {
    console.clear();
    
    const w = 62;
    console.log(chalk.cyan('+') + chalk.white.bold(' Thatgfsj Code 配置向导 ') + chalk.cyan('-'.repeat(w - 22)) + '+');
    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // 选择提供商
    console.log(chalk.cyan('|') + chalk.white(' 步骤 1/3: 选择 AI 提供商').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.green(' 1. SiliconFlow (推荐) - 国产模型，性价比高').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray(' 2. MiniMax - Moonshot Kimi 系列').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray(' 3. OpenAI - GPT-4o 系列').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray(' 4. Anthropic - Claude 系列').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray(' 5. Google Gemini - 免费模型').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray(' 6. Kimi (Moonshot AI) - 国产大模型').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray(' 7. DeepSeek - 性价比高').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray(' 8. 文心一言 (ERNIE) - 百度').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));

    const choice = await this.question(rl, chalk.green(' 请选择 (1-8): '));
    
    const providers: Record<string, { name: string; url: string; envKey: string; models: { id: string; name: string; desc: string }[] }> = {
      '1': { name: 'siliconflow', url: 'https://siliconflow.cn', envKey: 'SILICONFLOW_API_KEY', models: this.SILICONFLOW_MODELS },
      '2': { name: 'minimax', url: 'https://platform.minimax.io', envKey: 'MINIMAX_API_KEY', models: this.MINIMAX_MODELS },
      '3': { name: 'openai', url: 'https://platform.openai.com', envKey: 'OPENAI_API_KEY', models: this.OPENAI_MODELS },
      '4': { name: 'anthropic', url: 'https://www.anthropic.com', envKey: 'ANTHROPIC_API_KEY', models: this.ANTHROPIC_MODELS },
      '5': { name: 'gemini', url: 'https://aistudio.google.com/app/apikey', envKey: 'GEMINI_API_KEY', models: this.GEMINI_MODELS },
      '6': { name: 'kimi', url: 'https://platform.moonshot.cn', envKey: 'KIMI_API_KEY', models: this.KIMI_MODELS },
      '7': { name: 'deepseek', url: 'https://platform.deepseek.com', envKey: 'DEEPSEEK_API_KEY', models: this.DEEPSEEK_MODELS },
      '8': { name: 'ernie', url: 'https://login.bce.baidu.com', envKey: 'ERNIE_API_KEY', models: this.ERNIE_MODELS },
    };

    const selected = providers[choice] || providers['1'];
    
    // 输入 API Key
    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.white(' 步骤 2/3: 获取 API Key').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray(' 请访问: ' + selected.url).padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray(' 注册账号并获取 API Key').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));

    const apiKey = await this.question(rl, chalk.green(' 请输入 API Key: '));
    
    // 选择模型
    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.white(' 步骤 3/3: 选择模型').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));
    
    // 显示模型列表
    selected.models.forEach((model, idx) => {
      const num = (idx + 1).toString().padStart(2);
      console.log(chalk.cyan('|') + chalk.green(` ${num}. `) + chalk.gray(model.name.padEnd(25)) + chalk.gray(model.desc.padEnd(w - 34)) + chalk.cyan('|'));
    });
    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));

    const modelChoice = await this.question(rl, chalk.green(' 请选择模型编号 (1-' + selected.models.length + '): '));
    const modelIdx = parseInt(modelChoice) - 1;
    const selectedModel = selected.models[modelIdx] || selected.models[0];
    
    // 保存配置
    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.yellow(' 正在保存配置...').padEnd(w) + chalk.cyan('|'));

    // 保存到环境变量
    process.env[selected.envKey] = apiKey;
    
    const config = {
      model: selectedModel.id,
      apiKey: apiKey,
      provider: selected.name,
      temperature: 0.7,
      maxTokens: 4096
    };

    const configDir = join(homedir(), '.thatgfsj');
    const configPath = join(configDir, 'config.json');

    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.green(' ✓ 配置已保存!').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray('   提供商: ' + selected.name).padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray('   模型: ' + selectedModel.name).padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + ' '.repeat(w) + chalk.cyan('|'));
    console.log(chalk.cyan('|') + chalk.gray(' 运行 gfcode 开始使用').padEnd(w) + chalk.cyan('|'));
    console.log(chalk.cyan('+') + '-'.repeat(w) + '+');
    console.log();
    
    rl.close();
  }

  private static question(rl: readline.Interface, prompt: string): Promise<string> {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        resolve(answer.trim());
      });
    });
  }
}

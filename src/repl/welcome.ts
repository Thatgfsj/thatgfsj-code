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
  
  // SiliconFlow 推荐模型列表 (Agent 常用)
  static readonly SILICONFLOW_MODELS: ModelInfo[] = [
    { id: 'Qwen/Qwen2.5-7B-Instruct', name: 'Qwen2.5-7B (推荐)', desc: '性价比高，适合日常编程' },
    { id: 'Qwen/Qwen2.5-32B-Instruct', name: 'Qwen2.5-32B', desc: '更强性能，适合复杂任务' },
    { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5-72B', desc: '旗舰模型' },
    { id: 'Pro/moonshotai/Kimi-K2.5', name: 'Kimi-K2.5 (私有)', desc: 'Moonshot 强力模型' },
    { id: 'Pro/deepseek-ai/DeepSeek-V3', name: 'DeepSeek-V3', desc: '深度求索最新模型' },
    { id: 'Pro/deepseek-ai/DeepSeek-R1', name: 'DeepSeek-R1', desc: '推理能力强' },
    { id: 'THUDM/glm-4-9b-chat', name: 'GLM-4-9B', desc: '智谱模型' },
    { id: 'THUDM/glm-4-32b-chat', name: 'GLM-4-32B', desc: '智谱大模型' },
    { id: '01-ai/Yi-1.5-34B-Chat', name: 'Yi-1.5-34B', desc: '零一万物' },
    { id: 'microsoft/WizardLM-2-8x22B', name: 'WizardLM-2', desc: '微软开源' },
  ];

  // MiniMax 模型
  static readonly MINIMAX_MODELS = [
    { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5 (推荐)', desc: 'Agent 能力最强' },
    { id: 'MiniMax-M2.1', name: 'MiniMax-M2.1', desc: '稳定版本' },
  ];

  // OpenAI 模型
  static readonly OPENAI_MODELS = [
    { id: 'gpt-4o-mini', name: 'GPT-4o-mini (推荐)', desc: '性价比高' },
    { id: 'gpt-4o', name: 'GPT-4o', desc: '最新旗舰' },
    { id: 'gpt-4-turbo', name: 'GPT-4-Turbo', desc: '强性能' },
  ];

  // Anthropic 模型
  static readonly ANTHROPIC_MODELS = [
    { id: 'claude-3-haiku-20240307', name: 'Claude-3-Haiku (推荐)', desc: '快速响应' },
    { id: 'claude-3.5-sonnet-20241022', name: 'Claude-3.5-Sonnet', desc: '最新旗舰' },
    { id: 'claude-3-opus-20240229', name: 'Claude-3-Opus', desc: '最强性能' },
  ];

  // Gemini 模型
  static readonly GEMINI_MODELS = [
    { id: 'gemini-1.5-flash-8b', name: 'Gemini-1.5-Flash-8B (推荐)', desc: '免费快速' },
    { id: 'gemini-1.5-flash', name: 'Gemini-1.5-Flash', desc: '性价比高' },
    { id: 'gemini-1.5-pro', name: 'Gemini-1.5-Pro', desc: '最新旗舰' },
  ];

  // Kimi 模型 (Moonshot AI)
  static readonly KIMI_MODELS = [
    { id: 'moonshot-v1-8k', name: 'Moonshot-V1-8K (推荐)', desc: '日常编程' },
    { id: 'moonshot-v1-32k', name: 'Moonshot-V1-32K', desc: '更长上下文' },
    { id: 'moonshot-v1-128k', name: 'Moonshot-V1-128K', desc: '超长上下文' },
  ];

  // DeepSeek 模型
  static readonly DEEPSEEK_MODELS = [
    { id: 'deepseek-chat', name: 'DeepSeek-Chat (推荐)', desc: '性价比高' },
    { id: 'deepseek-coder', name: 'DeepSeek-Coder', desc: '编程专用' },
  ];

  // ERNIE 模型 (百度文心一言)
  static readonly ERNIE_MODELS = [
    { id: 'ernie-4.0-8k', name: 'ERNIE-4.0-8K (推荐)', desc: '百度旗舰' },
    { id: 'ernie-3.5-8k', name: 'ERNIE-3.5-8K', desc: '性价比高' },
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
    
    console.log(chalk.cyan('+') + chalk.white.bold(' Claude Code ') + chalk.cyan('-'.repeat(w - 14)) + '+');
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

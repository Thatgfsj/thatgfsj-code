/**
 * App - Core application singleton
 * Simplified: directly uses LLMService (which has built-in agent loop)
 */

import { ConfigManager } from '../config/index.js';
import { LLMService } from '../llm/index.js';
import { SessionManager } from '../session/index.js';
import { ToolRegistry } from '../tools/index.js';
import { HookManager } from '../hooks/index.js';
import { SystemPromptBuilder } from '../prompts/index.js';
import { SkillRegistry } from '../skills/index.js';
import type { ChatMessage, ChatResponse } from '../types.js';

export class App {
  config: ConfigManager;
  llm: LLMService;
  session: SessionManager;
  tools: ToolRegistry;
  hooks: HookManager;
  prompts: SystemPromptBuilder;
  skills: SkillRegistry;

  private constructor(
    config: ConfigManager,
    llm: LLMService,
    session: SessionManager,
    tools: ToolRegistry,
    hooks: HookManager,
    prompts: SystemPromptBuilder,
    skills: SkillRegistry,
  ) {
    this.config = config;
    this.llm = llm;
    this.session = session;
    this.tools = tools;
    this.hooks = hooks;
    this.prompts = prompts;
    this.skills = skills;
  }

  static async create(): Promise<App> {
    const config = await ConfigManager.load();
    const aiConfig = config.getAIConfig();

    const llm = LLMService.fromConfig(aiConfig);
    const session = new SessionManager(config.get().contextLength || 50);
    const tools = new ToolRegistry();
    const hooks = new HookManager();
    const skills = new SkillRegistry();

    // Register tools with LLM service
    llm.registerTools(tools.list());

    // Auto-init NWT timeline
    const nwtTool = tools.get('nwt');
    if (nwtTool) {
      await nwtTool.execute({ action: 'init' });
    }

    // Build system prompt with active skills
    const prompts = new SystemPromptBuilder({
      cwd: process.cwd(),
      tools: tools.list(),
      permissionMode: 'ask',
      skillsPrompt: skills.getActivePrompts(),
    });
    session.addMessage('system', prompts.build());

    return new App(config, llm, session, tools, hooks, prompts, skills);
  }

  /**
   * Stream a response for the current session messages.
   * The LLMService handles the full agent loop internally.
   */
  async *streamResponse(messages?: ChatMessage[]): AsyncGenerator<string, void> {
    const msgs = messages || this.session.getMessages();
    for await (const chunk of this.llm.chatStream(msgs)) {
      yield chunk;
    }
  }

  /**
   * Run a single prompt (non-interactive mode)
   */
  async runPrompt(prompt: string): Promise<string> {
    this.session.addMessage('user', prompt);

    let fullResponse = '';
    try {
      for await (const chunk of this.streamResponse()) {
        process.stdout.write(chunk);
        fullResponse += chunk;
      }
    } catch (err) {
      // Re-throw after saving partial response
      if (fullResponse) {
        this.session.addMessage('assistant', fullResponse);
      }
      throw err;
    }

    console.log();
    this.session.addMessage('assistant', fullResponse);
    return fullResponse;
  }
}

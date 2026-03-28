/**
 * Agent Module
 * Core agent logic with intent recognition, task planning, and streaming
 */

import { AIEngine } from '../core/ai-engine.js';
import { SessionManager } from '../core/session.js';
import { IntentRecognizer, Intent, SubTask } from './intent.js';
import { StreamingOutput } from './streaming.js';
import chalk from 'chalk';

export interface AgentConfig {
  maxIterations?: number;
  streaming?: boolean;
  verbose?: boolean;
}

export class Agent {
  private ai: AIEngine;
  private session: SessionManager;
  private intentRecognizer: IntentRecognizer;
  private config: AgentConfig;
  private streaming: StreamingOutput;

  constructor(ai: AIEngine, session: SessionManager, config?: AgentConfig) {
    this.ai = ai;
    this.session = session;
    this.intentRecognizer = new IntentRecognizer(ai);
    this.config = {
      maxIterations: 5,
      streaming: false,
      verbose: false,
      ...config
    };
    this.streaming = new StreamingOutput();
  }

  /**
   * Process user input through the agent
   */
  async process(input: string): Promise<string> {
    // Step 1: Recognize intent
    const intent = await this.intentRecognizer.recognize(input);
    
    if (this.config.verbose) {
      console.log(chalk.gray(`\n📍 Intent: ${intent.type} (${intent.confidence}) - ${intent.reason}`));
    }

    // Step 2: Handle complex tasks
    if (intent.type === 'complex') {
      return await this.handleComplexTask(input, intent);
    }

    // Step 3: Route to appropriate handler
    switch (intent.type) {
      case 'command':
        return await this.handleCommand(input);
      case 'query':
        return await this.handleQuery(input);
      case 'code':
      case 'chat':
      default:
        return await this.handleGeneral(input);
    }
  }

  /**
   * Handle complex multi-step tasks
   */
  private async handleComplexTask(input: string, intent: Intent): Promise<string> {
    const subtasks = await this.intentRecognizer.breakIntoSubtasks(input);
    
    if (this.config.verbose) {
      console.log(chalk.cyan(`\n📋 Breaking into ${subtasks.length} subtasks:`));
      subtasks.forEach((task, i) => {
        console.log(chalk.gray(`  ${i + 1}. ${task.description} [${task.action}]`));
      });
    }

    let results: string[] = [];

    for (let i = 0; i < subtasks.length; i++) {
      const task = subtasks[i];
      console.log(chalk.cyan(`\n[${i + 1}/${subtasks.length}] ${task.description}...`));
      
      const result = await this.process(task.description);
      results.push(result);
    }

    return results.join('\n\n');
  }

  /**
   * Handle command intent
   */
  private async handleCommand(input: string): Promise<string> {
    // Extract command from input
    const command = input
      .replace(/^(run|execute|exec)\s+/i, '')
      .trim();

    // Add to session and get response
    this.session.addMessage('user', input);
    
    const response = await this.ai.chat(this.session.getMessages(), this.config.maxIterations);
    
    this.session.addMessage('assistant', response.content);
    
    return response.content;
  }

  /**
   * Handle query intent
   */
  private async handleQuery(input: string): Promise<string> {
    this.session.addMessage('user', input);
    
    const response = await this.ai.chat(this.session.getMessages(), this.config.maxIterations);
    
    this.session.addMessage('assistant', response.content);
    
    return response.content;
  }

  /**
   * Handle general/code/chat intents
   */
  private async handleGeneral(input: string): Promise<string> {
    this.session.addMessage('user', input);
    
    const response = await this.ai.chat(this.session.getMessages(), this.config.maxIterations);
    
    this.session.addMessage('assistant', response.content);
    
    return response.content;
  }

  /**
   * Process with streaming output
   */
  async processStream(input: string, onChunk: (chunk: string) => void): Promise<string> {
    const wasStreaming = this.config.streaming;
    this.config.streaming = true;

    this.streaming.start({ onChunk });

    try {
      const result = await this.process(input);
      this.streaming.end();
      return result;
    } catch (error) {
      this.streaming.stop();
      throw error;
    } finally {
      this.config.streaming = wasStreaming;
    }
  }

  /**
   * Get session
   */
  getSession(): SessionManager {
    return this.session;
  }

  /**
   * Clear session
   */
  clearSession(): void {
    this.session.clear();
  }

  /**
   * Interrupt ongoing operation
   */
  interrupt(): void {
    this.streaming.stop();
  }
}

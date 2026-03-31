/**
 * S06: Subagent Manager
 * Spawn and manage subagents for parallel task execution
 * 
 * Subagents enable "infinite parallelism" — complex tasks are broken into
 * independent subtasks, each run by a separate agent instance.
 */

import { AIEngine, ChatMessage } from './ai-engine.js';
import { AIConfig } from './types.js';

export interface SubagentOptions {
  /** Task prompt for the subagent */
  prompt: string;
  /** Custom system prompt (optional) */
  systemPrompt?: string;
  /** Tools available to this subagent */
  tools?: any[];
  /** Max iterations for this subagent */
  maxIterations?: number;
  /** Subagent name for logging */
  name?: string;
  /** Working directory */
  cwd?: string;
}

export interface SubagentResult {
  success: boolean;
  output: string;
  error?: string;
  iterations: number;
  durationMs: number;
  name: string;
}

/**
 * S06: Subagent Manager
 */
export class SubagentManager {
  private config: AIConfig;
  private activeSubagents: Map<string, {
    task: Promise<SubagentResult>;
    startedAt: Date;
    name: string;
  }> = new Map();
  private maxConcurrent = 3;

  constructor(config: AIConfig) {
    this.config = config;
  }

  /**
   * S06: Spawn a subagent to run a task asynchronously
   */
  async spawn(options: SubagentOptions): Promise<SubagentResult> {
    const name = options.name || `subagent_${Date.now()}`;
    const startedAt = new Date();

    const task = this.runSubagent(name, options, startedAt);

    // Track active subagent
    this.activeSubagents.set(name, { task, startedAt, name });

    // Auto-cleanup after completion
    task.then(() => {
      setTimeout(() => this.activeSubagents.delete(name), 5000);
    }).catch(() => {
      this.activeSubagents.delete(name);
    });

    // Return handle — caller can await or ignore
    return task;
  }

  /**
   * S06: Spawn multiple subagents in parallel (bounded concurrency)
   */
  async spawnAll(tasks: SubagentOptions[]): Promise<SubagentResult[]> {
    const results: SubagentResult[] = [];
    const queue = [...tasks];
    const running: Promise<void>[] = [];

    while (queue.length > 0 || running.length > 0) {
      while (running.length < this.maxConcurrent && queue.length > 0) {
        const task = queue.shift()!;
        const p: Promise<void> = this.spawn(task).then(r => { results.push(r); }).then(() => {});
        running.push(p);
      }

      if (running.length > 0) {
        await Promise.race(running).catch(() => {});
        await Promise.allSettled(running);
        running.length = 0;
      }
    }

    return results;
  }

  /**
   * S06: Run a single subagent task
   */
  private async runSubagent(
    name: string,
    options: SubagentOptions,
    startedAt: Date
  ): Promise<SubagentResult> {
    const startMs = Date.now();
    let iterations = 0;
    const maxIterations = options.maxIterations || 5;

    try {
      // Create isolated AI engine for subagent
      const subAI = new AIEngine({
        ...this.config,
        model: options.systemPrompt ? (this.config.model || 'unknown') : this.config.model
      });

      // Register tools if provided
      if (options.tools) {
        for (const tool of options.tools) {
          subAI.registerTool(tool);
        }
      }

      // Build messages
      const messages: ChatMessage[] = [];
      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      } else {
        messages.push({
          role: 'system',
          content: 'You are ' + (options.name || 'a subagent') + '. Complete the task assigned by the parent agent. Be concise and focused.'
        });
      }
      messages.push({ role: 'user', content: options.prompt });

      // Run agent loop
      let output = '';
      for await (const chunk of subAI.chatStream(messages, maxIterations)) {
        output += chunk;
        iterations++;
      }

      return {
        success: true,
        output,
        iterations,
        durationMs: Date.now() - startMs,
        name
      };

    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message,
        iterations,
        durationMs: Date.now() - startMs,
        name
      };
    }
  }

  /**
   * S06: Get number of active subagents
   */
  getActiveCount(): number {
    return this.activeSubagents.size;
  }

  /**
   * S06: Get active subagent names
   */
  getActiveNames(): string[] {
    return [...this.activeSubagents.values()].map(s => s.name);
  }

  /**
   * S06: Abort all active subagents
   */
  abortAll(): void {
    for (const [name] of this.activeSubagents) {
      // Subagents don't have abort support yet, just remove from tracking
      this.activeSubagents.delete(name);
    }
  }

  /**
   * S06: Set max concurrent subagents
   */
  setMaxConcurrent(max: number) {
    this.maxConcurrent = max;
  }
}

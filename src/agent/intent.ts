/**
 * Intent Recognition
 * Identifies user intent: chat, code, command, or query
 */

export interface Intent {
  type: 'chat' | 'code' | 'command' | 'query' | 'complex';
  confidence: number;
  reason?: string;
  subTasks?: SubTask[];
}

export interface SubTask {
  description: string;
  action: string;
  target?: string;
}

/**
 * Intent Recognition Prompt
 */
const INTENT_PROMPT = `Analyze the user message and identify their intent.

Intent types:
- "chat": General conversation, questions, small talk
- "code": Write, edit, refactor code
- "command": Execute shell commands, git operations
- "query": Search files, find information, read code
- "complex": Multiple actions needed - break into subtasks

Respond with JSON:
{
  "type": "chat|code|command|query|complex",
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "subTasks": [{"description": "...", "action": "...", "target": "..."}] // only for complex
}

User message:`;

export class IntentRecognizer {
  private ai: any;

  constructor(aiEngine: any) {
    this.ai = aiEngine;
  }

  /**
   * Recognize intent from user message
   */
  async recognize(message: string): Promise<Intent> {
    // Fast path: simple keyword matching for common patterns
    const fastIntent = this.fastRecognize(message);
    if (fastIntent.confidence > 0.8) {
      return fastIntent;
    }

    // Use AI for complex cases
    return await this.aiRecognize(message);
  }

  /**
   * Fast keyword-based recognition
   */
  private fastRecognize(message: string): Intent {
    const lower = message.toLowerCase().trim();
    const words = lower.split(/\s+/);

    // Command patterns
    const commandPatterns = [
      /^run\s+/, /^execute\s+/, /^exec\s+/,
      /^npm\s+/, /^node\s+/, /^git\s+/,
      /^pip\s+/, /^python\s+/, /^cargo\s+/,
      /^make\s+/, /^docker\s+/, /^curl\s+/,
    ];

    for (const pattern of commandPatterns) {
      if (pattern.test(lower)) {
        return { type: 'command', confidence: 0.9, reason: 'Command pattern detected' };
      }
    }

    // Code patterns
    const codePatterns = [
      /^write\s+/, /^create\s+.*file/i,
      /^edit\s+/, /^modify\s+/, /^change\s+/,
      /^refactor/i, /^implement/i,
      /^add\s+.*function/i, /^add\s+.*class/i,
      /\{[\s\S]*\}/,  // Contains code block
      /function\s+\w+\s*\(/,
      /const\s+\w+\s*=/,
      /let\s+\w+\s*=/,
      /class\s+\w+/,
    ];

    for (const pattern of codePatterns) {
      if (pattern.test(message)) {
        return { type: 'code', confidence: 0.85, reason: 'Code pattern detected' };
      }
    }

    // Query patterns
    const queryPatterns = [
      /^find\s+/, /^search\s+/, /^grep\s+/,
      /^show\s+.*files/i, /^list\s+.*files/i,
      /^what\s+is\s+/, /^how\s+does\s+/,
      /^explain\s+/, /^what's\s+in\s+/,
      /^read\s+/, /^look\s+at\s+/,
    ];

    for (const pattern of queryPatterns) {
      if (pattern.test(lower)) {
        return { type: 'query', confidence: 0.85, reason: 'Query pattern detected' };
      }
    }

    // Complex task patterns (multiple actions)
    const complexPatterns = [
      /refactor.*and.*test/i,
      /create.*and.*setup/i,
      /build.*and.*deploy/i,
      /fix.*and.*verify/i,
      /migrate.*to/i,
      /rewrite.*from/i,
    ];

    for (const pattern of complexPatterns) {
      if (pattern.test(lower)) {
        return { type: 'complex', confidence: 0.8, reason: 'Multiple actions detected' };
      }
    }

    // Default to chat
    return { type: 'chat', confidence: 0.6, reason: 'Default intent' };
  }

  /**
   * AI-powered recognition for ambiguous cases
   */
  private async aiRecognize(message: string): Promise<Intent> {
    // For now, use fast recognition as fallback
    // TODO: Implement AI-based recognition for complex cases
    return this.fastRecognize(message);
  }

  /**
   * Break complex task into subtasks
   */
  async breakIntoSubtasks(message: string): Promise<SubTask[]> {
    const lower = message.toLowerCase();

    // Simple rule-based decomposition
    const tasks: SubTask[] = [];

    // "refactor X and add tests"
    if (lower.includes('refactor') && lower.includes('test')) {
      tasks.push({ description: 'Refactor code', action: 'code', target: 'refactor' });
      tasks.push({ description: 'Add tests', action: 'code', target: 'test' });
    }

    // "create X and setup Y"
    if (lower.includes('create') && lower.includes('setup')) {
      tasks.push({ description: 'Create component', action: 'code', target: 'create' });
      tasks.push({ description: 'Setup configuration', action: 'command', target: 'setup' });
    }

    // "fix X and verify"
    if (lower.includes('fix') && (lower.includes('verify') || lower.includes('test'))) {
      tasks.push({ description: 'Fix issue', action: 'code', target: 'fix' });
      tasks.push({ description: 'Verify fix', action: 'command', target: 'test' });
    }

    // If no decomposition rules matched, treat as single task
    if (tasks.length === 0) {
      const intent = this.fastRecognize(message);
      tasks.push({ description: message, action: intent.type, target: message });
    }

    return tasks;
  }
}

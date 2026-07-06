/**
 * Session Manager - Manages conversation history
 *
 * F4 (anti-[已中断]):
 *   - addMessage 拦截含"已中断" / 链形 think 块等污染字符串
 *     （之前 AI 在失败重试时会把这些字面写进 history 造成病毒循环）
 *   - sanitize() 在 lastMessages 输出到 LLM 前再做一次去噪
 */

import { ChatMessage, Session } from './types.js';

/**
 * Patterns that indicate the message is polluted by a previous broken
 * tool/stream retry loop. These should never be re-sent to the LLM.
 */
const POLLUTION_PATTERNS: RegExp[] = [
  /\[已中断/,                       // literally "[已中断" - sentinel from bad run
  /\u5df2\u4e2d\u65ad/,              // 已中断 (escaped form)
  /^\s*\[已中断\s*$/m,                // line that is exactly [已中断
  /^<think>[\s\S]*?<\/think>\s*$/m,  // entire message that is just a think block
  /\u{1F6AB}/u,                     // ⛔ emoji sometimes used as interrupt marker
];

function looksPolluted(content: string): boolean {
  if (!content) return false;
  // Strip obvious thinking fences and check the *remaining* core content.
  const stripped = content
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<\/?think>/g, '')
    .trim();

  for (const p of POLLUTION_PATTERNS) {
    if (p.test(content)) return true;
  }

  // A message whose entire stripped form is shorter than 6 chars AND
  // contains an interruption-related token is also suspect.
  if (stripped.length < 6 && /(中断|interrupted|cancelled|已取消)/i.test(stripped)) {
    return true;
  }
  return false;
}

export class SessionManager {
  private messages: ChatMessage[] = [];
  private sessionId: string;
  private createdAt: Date;
  private droppedCount = 0;

  constructor() {
    this.sessionId = this.generateId();
    this.createdAt = new Date();
  }

  /**
   * Add a message to the session.
   * Returns true if accepted, false if dropped because it looked polluted.
   */
  addMessage(role: ChatMessage['role'], content: string): boolean {
    if (role !== 'system' && looksPolluted(content)) {
      this.droppedCount++;
      // Keep a 1-line internal note so the user can see *something* happened,
      // but the original polluted text does NOT go to the LLM context.
      this.messages.push({
        role: 'user',
        content: '[system: dropped a polluted prior message containing "已中断" markers. Continue with the original task.]',
        name: 'system'
      });
      return false;
    }

    this.messages.push({
      role,
      content,
      name: role === 'user' ? 'user' : undefined
    });
    return true;
  }

  /**
   * Add a message WITHOUT any sanitization (for trusted callers, e.g. system prompt)
   */
  addMessageRaw(role: ChatMessage['role'], content: string): void {
    this.messages.push({ role, content });
  }

  /**
   * How many polluted messages have we filtered out? Useful for debugging
   * the "AI keeps saying interrupted" loop.
   */
  getDroppedCount(): number {
    return this.droppedCount;
  }

  /**
   * Return messages ready to send to the LLM.  We additionally dedupe
   * adjacent identical assistant messages (a recovery hack against the
   * "AI repeats the same paragraph each turn" loop).
   */
  getMessages(): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (let i = 0; i < this.messages.length; i++) {
      const m = this.messages[i];
      const prev = out[out.length - 1];
      if (
        prev &&
        m.role === 'assistant' &&
        prev.role === 'assistant' &&
        m.content.length > 0 &&
        m.content === prev.content
      ) {
        // collapse identical neighbour
        continue;
      }
      out.push(m);
    }
    return out;
  }

  /**
   * Get message count (raw, includes internal notes)
   */
  getMessageCount(): number {
    return this.messages.length;
  }

  /**
   * Clear session history
   */
  clear(): void {
    this.messages = [];
    this.droppedCount = 0;
  }

  /**
   * Get session info
   */
  getSession(): Session {
    return {
      id: this.sessionId,
      messages: this.messages,
      createdAt: this.createdAt,
      lastActiveAt: new Date()
    };
  }

  /**
   * Truncate messages to fit token limit
   */
  truncate(maxMessages: number = 20): void {
    if (this.messages.length > maxMessages) {
      const systemMsg = this.messages.find(m => m.role === 'system');
      const otherMsgs = this.messages.filter(m => m.role !== 'system');

      this.messages = [
        ...(systemMsg ? [systemMsg] : []),
        ...otherMsgs.slice(-(maxMessages - 1))
      ];
    }
  }

  private generateId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

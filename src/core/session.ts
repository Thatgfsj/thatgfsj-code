/**
 * Session Manager - Manages conversation history
 *
 * 2.1.1: Removed the anti-[已中断] filter that used to live here. That
 * filter was originally added as a downstream workaround for a much
 * deeper bug: `REPLLoop.processInput` would persist *truncated* assistant
 * responses into history when the user pressed Ctrl+C, and the LLM would
 * then generate a literal `[已中断]` token as a recovery fallback on the
 * next turn, which got re-fed into itself indefinitely.
 *
 * The proper fix was to stop writing truncated responses into history at
 * all (REPLLoop._wasAborted, in 2.1.0). With that fix in place the
 * filter is obsolete — and worse, it was actively rejecting *legitimate*
 * assistant replies such as:
 *   - "I see you wrote [已中断] in your message. Did you mean…?"
 *   - "<think>analysis</think>\n\nreply text here"
 * i.e. the regex was matching texts that any reasonable LLM would produce
 * in normal conversation.
 *
 * We now keep `addMessage` as a pure passthrough. If a future regression
 * reintroduces the underlying abort-write bug, we want to see it as a
 * missing-context error from the LLM (which is obvious), NOT a silent
 * filter that drops messages the user can't see.
 */

import { ChatMessage, Session } from './types.js';

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
   * Add a message to the session. Pure passthrough — no filter, no
   * "dropped" pathway. Returns `true` for symmetry with the prior API.
   *
   * If callers need to skip a message they can simply not call us.
   */
  addMessage(role: ChatMessage['role'], content: string): boolean {
    this.messages.push({
      role,
      content,
      name: role === 'user' ? 'user' : undefined,
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

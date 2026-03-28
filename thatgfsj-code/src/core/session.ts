/**
 * Session Manager - Manages conversation history
 */

import { ChatMessage, Session } from './types.js';

export class SessionManager {
  private messages: ChatMessage[] = [];
  private sessionId: string;
  private createdAt: Date;

  constructor() {
    this.sessionId = this.generateId();
    this.createdAt = new Date();
  }

  /**
   * Add a message to the session
   */
  addMessage(role: ChatMessage['role'], content: string): void {
    this.messages.push({
      role,
      content,
      name: role === 'user' ? 'user' : undefined
    });
  }

  /**
   * Get all messages
   */
  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /**
   * Get message count
   */
  getMessageCount(): number {
    return this.messages.length;
  }

  /**
   * Clear session history
   */
  clear(): void {
    this.messages = [];
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
      // Keep system message if exists
      const systemMsg = this.messages.find(m => m.role === 'system');
      const otherMsgs = this.messages.filter(m => m.role !== 'system');
      
      this.messages = [
        ...(systemMsg ? [systemMsg] : []),
        ...otherMsgs.slice(-(maxMessages - 1))
      ];
    }
  }

  /**
   * Generate unique session ID
   */
  private generateId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

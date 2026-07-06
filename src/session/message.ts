/**
 * Message types and utilities
 */

import type { ChatMessage, Role } from '../types.js';

export { ChatMessage, Role };

/**
 * Create a message
 */
export function createMessage(role: Role, content: string, extras?: Partial<ChatMessage>): ChatMessage {
  return { role, content, ...extras };
}

/**
 * Create a system message
 */
export function systemMessage(content: string): ChatMessage {
  return { role: 'system', content };
}

/**
 * Create a user message
 */
export function userMessage(content: string): ChatMessage {
  return { role: 'user', content };
}

/**
 * Create an assistant message
 */
export function assistantMessage(content: string): ChatMessage {
  return { role: 'assistant', content };
}

/**
 * Create a tool result message
 */
export function toolMessage(content: string, toolCallId: string, name: string): ChatMessage {
  return { role: 'tool', content, tool_call_id: toolCallId, name };
}

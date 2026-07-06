/**
 * Global shared types for Thatgfsj Code
 * Only the most fundamental types used across modules
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: Role;
  content: string;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatResponse {
  content: string;
  role: 'assistant';
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  tool_calls?: ToolCall[];
  reasoning_content?: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

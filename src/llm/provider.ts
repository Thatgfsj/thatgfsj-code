/**
 * Abstract LLM Provider interface
 * All providers implement this interface
 */

import type { ChatMessage, ChatResponse, ChatOptions, ToolCall } from '../types.js';
import type { Tool } from '../tools/types.js';

export interface StreamChunk {
  type: 'text' | 'tool_calls';
  content?: string;
  toolCalls?: ToolCall[];
}

export interface LLMProvider {
  readonly name: string;

  /** Non-streaming chat with optional tools */
  chat(messages: ChatMessage[], options?: ChatOptions, tools?: Tool[]): Promise<ChatResponse>;

  /** Streaming chat with optional tools - yields StreamChunks */
  chatStream(messages: ChatMessage[], options?: ChatOptions, tools?: Tool[]): AsyncGenerator<StreamChunk, ChatResponse>;

  /** Convert Tool[] to provider-specific format */
  buildTools(tools: Tool[]): any[];
}

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
}

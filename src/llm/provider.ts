/**
 * Abstract LLM Provider interface
 * All providers implement this interface.
 *
 * v3.0.0+: StreamChunk is now imported from the shared types module so that
 * TUI / session / cache layers can consume it uniformly. Providers no longer
 * carry their own definition; see src/types.ts for the union (text/tool_calls/
 * thinking/usage). The previous local 'text' | 'tool_calls' shape was kept as
 * a structural type alias for backward compatibility with existing call sites
 * that destructure by .type only.
 */

import type { ChatMessage, ChatResponse, ChatOptions, StreamChunk as SharedStreamChunk } from '../types.js';
import type { Tool } from '../tools/types.js';

/**
 * Re-export of the structured streaming chunk. Now structurally compatible
 * with the old { type, content?, toolCalls? } shape — callers that previously
 * destructured chunk.type and chunk.content / chunk.toolCalls still work, and
 * new variants ('thinking', 'usage') are opt-in.
 */
export type StreamChunk = SharedStreamChunk;

export interface LLMProvider {
  readonly name: string;

  /** Non-streaming chat with optional tools */
  chat(messages: ChatMessage[], options?: ChatOptions, tools?: Tool[]): Promise<ChatResponse>;

  /**
   * Streaming chat with optional tools.
   * Yields structured StreamChunks:
   *   { type: 'text',       content: string }
   *   { type: 'tool_calls', toolCalls: ToolCall[] }
   *   { type: 'thinking',   content: string }
   *   { type: 'usage',      usage: Usage }
   * Returns the final ChatResponse (with usage) when the stream completes.
   */
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
  /**
   * Optional cache control policy. When omitted, providers fall back to their
   * default behavior (Anthropic: explicit cache_control markers; OpenAI / Gemini
   * / DeepSeek: automatic prefix cache, no markers needed).
   *
   * v3.0.3: `ttl` accepts '5m' | '1h' | 'auto'. 'auto' lets the runtime
   * decide per-session via decideTTL() in cache/smartModel.ts. The actual
   * value used at request time is what gets stored on the provider's
   * resolvedTtl field (set by LLMService.chatStream).
   */
  cache?: {
    enabled: boolean;
    ttl?: '5m' | '1h' | 'auto';
    /**
     * 'auto'   — provider default (Anthropic: explicit, OpenAI/DeepSeek: auto)
     * 'manual' — always emit cache_control markers regardless of provider
     * 'off'    — never emit markers (force disable, useful for benchmarking)
     */
    strategy?: 'auto' | 'manual' | 'off';
  };
}

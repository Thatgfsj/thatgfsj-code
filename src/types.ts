/**
 * Global shared types for Thatgfsj Code
 * Only the most fundamental types used across modules
 *
 * v3.0.0+: Extended for Reasonix-style prompt caching:
 *   - ChatMessage.content now accepts ContentBlock[] (Anthropic-style)
 *   - cache_control field for explicit Anthropic cache breakpoints
 *   - usage extended with cache_creation_input_tokens / cache_read_input_tokens
 *     (Anthropic) and prompt_cache_hit_tokens / prompt_cache_miss_tokens (DeepSeek)
 *   - StreamChunk now has 'thinking' / 'usage' variants for structured streaming
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Anthropic-style cache control. ttl: '5m' (default) | '1h'
 * - '5m': cheaper write cost, refreshed on each hit, expires 5 min after last hit
 * - '1h': more expensive write cost, expires 1 hour after last hit
 */
export interface CacheControl {
  type: 'ephemeral';
  ttl?: '5m' | '1h';
}

/**
 * Anthropic-style content blocks. text carries optional cache_control so that
 * Anthropic prompt caching breakpoints can be placed inside messages.
 */
export type ContentBlock =
  | { type: 'text'; text: string; cache_control?: CacheControl }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface ChatMessage {
  role: Role;
  /**
   * For 'system' / 'user' / 'assistant' (text only): a plain string.
   * For 'user' (multimodal) or 'assistant' (Anthropic tool_use mixed with text):
   * an array of ContentBlock.
   * 'tool' messages must use string content (carries tool result text).
   */
  content: string | ContentBlock[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
  /**
   * Anthropic prompt caching marker attached to the message itself.
   * Only honored when the underlying provider supports it (anthropic, anthropic-relay).
   * OpenAI / Gemini / DeepSeek ignore it (DeepSeek uses automatic prefix cache).
   */
  cache_control?: CacheControl;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  // Anthropic prompt cache fields
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  // DeepSeek prompt cache fields
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export interface ChatResponse {
  content: string;
  role: 'assistant';
  usage?: Usage;
  tool_calls?: ToolCall[];
  reasoning_content?: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

/**
 * Structured streaming chunk. Replaces the legacy @@TOOL@@ sentinel-string
 * protocol that the previous version of useChat parsed by string-splitting.
 *
 * - 'text':        regular model output
 * - 'tool_calls':  one or more tool calls ready to dispatch
 * - 'thinking':    reasoning content (stripped from final persistence; kept in
 *                  VolatileScratch for the current round only)
 * - 'usage':       token usage + cache stats; emitted at end of stream if
 *                  the upstream provider returned them
 */
export type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'tool_calls'; toolCalls: ToolCall[] }
  | { type: 'thinking'; content: string }
  | { type: 'usage'; usage: Usage };

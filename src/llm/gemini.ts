/**
 * Google Gemini Provider
 *
 * v3.0.5 fixes:
 *   - API key moved out of the URL query string into the x-goog-api-key
 *     header (keys in URLs leak into proxy/server logs).
 *   - Multi-turn tool calling now round-trips correctly: assistant
 *     tool_calls are mapped back to model functionCall parts and tool
 *     results are sent as functionResponse parts. Previously tool results
 *     were flattened into a plain text user message, so the model lost the
 *     call->result linkage and multi-step tool chains broke.
 *   - ALL system messages are forwarded (the previous code silently dropped
 *     every system message after the first).
 * v3.0.18 fixes:
 *   - Only the FIRST system message goes into systemInstruction; later
 *     system messages ([TOOL_REPAIR] notes) are inlined in place as user
 *     turns tagged '[system note] ' so the instruction prefix stays stable
 *     for Gemini's implicit prefix cache.
 *   - Gemini "thought" parts are filtered out of chat() and chatStream()
 *     output, and chat() gained a 60s AbortSignal.timeout.
 *   - Streaming now captures usageMetadata and yields a { type: 'usage' }
 *     chunk like the other providers.
 *   - Caller cancellation via options.signal + 120s idle watchdog.
 */

import type { ChatMessage, ChatResponse, ChatOptions, ToolCall, StreamChunk, Usage } from '../types.js';
import type { Tool } from '../tools/types.js';
import type { LLMProvider, ProviderConfig } from './provider.js';

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  buildTools(tools: Tool[]): any[] {
    return [{
      functionDeclarations: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema || {
          type: 'object',
          properties: Object.fromEntries(
            tool.parameters.map(p => [p.name, { type: p.type, description: p.description }])
          ),
          required: tool.parameters.filter(p => p.required).map(p => p.name),
        },
      })),
    }];
  }

  /** Extract message text whether content is a string or ContentBlock[]. */
  private static textOf(content: ChatMessage['content']): string {
    if (typeof content === 'string') return content;
    return content.filter(b => b.type === 'text').map(b => (b as any).text).join('');
  }

  /**
   * Convert our canonical ChatMessage[] into Gemini `contents`.
   * Tool-call pairing is preserved: assistant.tool_calls -> model
   * functionCall parts; tool messages -> user functionResponse parts.
   *
   * v3.0.18: only the FIRST system message is skipped here (buildRequest
   * hoists it into systemInstruction). Every LATER system message — e.g.
   * `[TOOL_REPAIR]` notes appended by the agent loop — is inlined at its
   * original position as a user turn tagged '[system note] '. Appending
   * those notes to systemInstruction used to change the instruction prefix
   * every round and defeat Gemini's implicit prefix cache.
   */
  private buildContents(messages: ChatMessage[]): any[] {
    const contents: any[] = [];
    let seenFirstSystem = false;
    for (const m of messages) {
      if (m.role === 'system') {
        if (!seenFirstSystem) {
          seenFirstSystem = true;
          continue;
        }
        contents.push({
          role: 'user',
          parts: [{ text: '[system note] ' + GeminiProvider.textOf(m.content) }],
        });
        continue;
      }

      if (m.role === 'tool') {
        // Tool result -> user turn with functionResponse part.
        // Gemini requires the function name on the response, which travels
        // on our message as `name` (set by the agent loop).
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: m.name || 'unknown_tool',
              response: { result: m.content },
            },
          }],
        });
        continue;
      }

      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        // Assistant turn with tool calls -> model functionCall parts.
        const parts: any[] = [];
        const text = GeminiProvider.textOf(m.content);
        if (text) parts.push({ text });
        for (const tc of m.tool_calls) {
          let args: unknown = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
          parts.push({ functionCall: { name: tc.function.name, args } });
        }
        contents.push({ role: 'model', parts });
        continue;
      }

      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: GeminiProvider.textOf(m.content) }],
      });
    }
    return contents;
  }

  private buildRequest(messages: ChatMessage[], options?: ChatOptions, tools?: Tool[]) {
    // v3.0.18: only the FIRST system message is concatenated into
    // systemInstruction (the v3.0.5 `find()` bug of dropping every system
    // message after the first is still fixed — later system messages are
    // now inlined into contents by buildContents, at their original
    // position, so they reach the model without moving the instruction
    // prefix).
    const firstSystem = messages.find(m => m.role === 'system');
    const systemText = firstSystem ? GeminiProvider.textOf(firstSystem.content) : '';

    const body: any = {
      contents: this.buildContents(messages),
      generationConfig: {
        temperature: options?.temperature ?? this.config.temperature,
        maxOutputTokens: options?.maxTokens ?? this.config.maxTokens,
      },
    };
    if (systemText) {
      body.systemInstruction = { parts: [{ text: systemText }] };
    }
    if (tools && tools.length > 0) {
      body.tools = this.buildTools(tools);
    }
    return body;
  }

  private authHeaders(): Record<string, string> {
    // v3.0.5: key in a header, not the URL — URLs end up in proxy and
    // server access logs.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers['x-goog-api-key'] = this.config.apiKey;
    return headers;
  }

  private normalizeUsage(raw: any): Usage {
    return {
      prompt_tokens: raw.promptTokenCount || 0,
      completion_tokens: raw.candidatesTokenCount || 0,
      total_tokens: raw.totalTokenCount || 0,
      // v3.4.10: Gemini's explicit cached-content reporting was dropped.
      cached_tokens: raw.cachedContentTokenCount ?? undefined,
    };
  }

  async chat(messages: ChatMessage[], options?: ChatOptions, tools?: Tool[]): Promise<ChatResponse> {
    const body = this.buildRequest(messages, options, tools);
    const url = `${this.config.baseUrl}/models/${this.config.model}:generateContent`;

    // v3.0.18: hard 60s timeout so a hung generateContent call can't stall
    // the CLI forever (chatStream already had the idle watchdog; chat() had
    // no timeout at all unless the caller passed a signal).
    const timeoutSignal = AbortSignal.timeout(60000);
    const signal = options?.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Gemini API error ${response.status}: ${text.slice(0, 500)}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    // v3.5.4: `candidates: []` used to parse to an empty success.
    if (!candidate) {
      throw new Error('Gemini API returned a malformed response (no candidates). This is a provider-side failure, not an empty answer.');
    }
    const parts = candidate?.content?.parts || [];
    // v3.0.18: skip Gemini "thought" parts (extended-thinking summaries) —
    // leaking them into content corrupted the visible answer and got
    // persisted into the session transcript.
    const text = parts
      .filter((p: any) => p.text && !p.thought)
      .map((p: any) => p.text)
      .join('');

    const functionCalls = parts.filter((p: any) => p.functionCall).map((p: any) => ({
      id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'function' as const,
      function: {
        name: p.functionCall.name,
        arguments: JSON.stringify(p.functionCall.args || {}),
      },
    }));

    return {
      content: text,
      role: 'assistant',
      usage: data.usageMetadata ? this.normalizeUsage(data.usageMetadata) : undefined,
      tool_calls: functionCalls.length > 0 ? functionCalls : undefined,
    };
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions, tools?: Tool[]): AsyncGenerator<StreamChunk, ChatResponse> {
    const body = this.buildRequest(messages, options, tools);
    const url = `${this.config.baseUrl}/models/${this.config.model}:streamGenerateContent?alt=sse`;

    const controller = new AbortController();
    const upstream = options?.signal;
    const onUpstreamAbort = () => controller.abort();
    upstream?.addEventListener('abort', onUpstreamAbort, { once: true });
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), 120000);
    };
    resetIdle();

    let fullContent = '';
    let buffer = '';
    const functionCalls: ToolCall[] = [];
    let capturedUsage: Usage | undefined;
    // v3.5.3: garbage 200 bodies must fail loudly, not read as success.
    let sawValidFrame = false;
    // v3.5.4: finishReason marks a complete stream — without it the answer
    // was cut off mid-stream (MAX_TOKENS etc. still SET finishReason, so
    // only a hard truncation fails here).
    let sawFinish = false;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      resetIdle();

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new Error(`Gemini API error ${response.status}: ${text.slice(0, 500)}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          resetIdle();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            try {
              const data = JSON.parse(trimmed.slice(6));
              if (data && typeof data === 'object') sawValidFrame = true;
              if (data.candidates?.[0]?.finishReason) sawFinish = true;
              if (data.usageMetadata) {
                capturedUsage = this.normalizeUsage(data.usageMetadata);
              }
              const parts = data.candidates?.[0]?.content?.parts || [];
              for (const part of parts) {
                // v3.0.18: skip thought parts in streaming too — they are
                // reasoning summaries, not user-visible answer text.
                if (part.text && !part.thought) {
                  fullContent += part.text;
                  yield { type: 'text', content: part.text };
                }
                if (part.functionCall) {
                  functionCalls.push({
                    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    type: 'function',
                    function: {
                      name: part.functionCall.name,
                      arguments: JSON.stringify(part.functionCall.args || {}),
                    },
                  });
                }
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        upstream?.removeEventListener('abort', onUpstreamAbort);
        reader.releaseLock();
      }
    } catch (error: any) {
      if (idleTimer) clearTimeout(idleTimer);
      upstream?.removeEventListener('abort', onUpstreamAbort);
      if (controller.signal.aborted && !upstream?.aborted) {
        throw new Error('Stream stalled: no data received for 120s');
      }
      // v3.5.4 (field report P1): bare "fetch failed" gave relay users no
      // path forward — name the two usual suspects.
      if (error instanceof TypeError && /fetch/i.test(error.message || '')) {
        throw new Error(
          `Gemini request failed: ${error.message}. If you use a relay, its baseUrl must point at a Gemini-compatible endpoint ` +
          '(configure it under the custom Gemini provider — the built-in gemini provider always calls the official endpoint).',
        );
      }
      throw error;
    }

    // v3.5.3: garbage 200 body (no valid SSE frames) fails loudly.
    // v3.5.4: valid frames but no finishReason = truncated mid-answer.
    if (!sawValidFrame || !sawFinish) {
      throw new Error(
        sawValidFrame
          ? 'Gemini stream ended without a finishReason (truncated response). This is a provider-side failure, not an empty answer.'
          : 'Gemini API returned an empty or malformed response body (no valid SSE frames). This is a provider-side failure, not an empty answer.',
      );
    }

    if (functionCalls.length > 0) {
      yield { type: 'tool_calls', toolCalls: functionCalls };
    }
    if (capturedUsage) {
      yield { type: 'usage', usage: capturedUsage };
    }

    return {
      content: fullContent,
      role: 'assistant',
      usage: capturedUsage,
      tool_calls: functionCalls.length > 0 ? functionCalls : undefined,
    };
  }
}

/**
 * AI Engine - Core AI interaction module
 */

import { ChatMessage, AIResponse, AIConfig } from './types.js';

export class AIEngine {
  private config: AIConfig;
  private baseUrl: string;

  constructor(config: AIConfig) {
    this.config = config;
    // Use OpenClaw's MiniMax API by default
    this.baseUrl = 'https://api.minimax.chat/v1';
  }

  /**
   * Send a chat request to AI
   */
  async chat(messages: ChatMessage[]): Promise<AIResponse> {
    const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      // Fallback: mock response for demo
      return this.mockResponse(messages);
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model || 'minimax/MiniMax-M2.5',
          messages: messages.map(m => ({
            role: m.role,
            content: m.content
          })),
          temperature: this.config.temperature || 0.7,
          max_tokens: this.config.maxTokens || 4096,
          stream: false
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      
      return {
        content: data.choices[0]?.message?.content || 'No response',
        role: 'assistant',
        usage: data.usage
      };
    } catch (error: any) {
      // Fallback to mock on error
      console.warn('API call failed, using mock response:', error.message);
      return this.mockResponse(messages);
    }
  }

  /**
   * Stream chat response
   */
  async *streamChat(messages: ChatMessage[]): AsyncGenerator<string> {
    const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      // Mock streaming
      const response = await this.mockResponse(messages);
      for (const char of response.content) {
        yield char;
        await new Promise(r => setTimeout(r, 20));
      }
      return;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model || 'minimax/MiniMax-M2.5',
        messages: messages.map(m => ({
          role: m.role,
          content: m.content
        })),
        temperature: this.config.temperature || 0.7,
        max_tokens: this.config.maxTokens || 4096,
        stream: true
      })
    });

    if (!response.ok || !response.body) {
      throw new Error(`Stream Error: ${response.status}`);
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            const data = JSON.parse(line.slice(6));
            const content = data.choices[0]?.delta?.content;
            if (content) yield content;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Mock response for demo/testing
   */
  private async mockResponse(messages: ChatMessage[]): Promise<AIResponse> {
    const lastMessage = messages[messages.length - 1]?.content || '';
    
    // Simple pattern matching for demo
    let response = 'Hello! I am Thatgfsj Code, your AI coding assistant.\n\n';
    
    if (lastMessage.toLowerCase().includes('hello') || lastMessage.toLowerCase().includes('hi')) {
      response = 'Hi there! How can I help you today?';
    } else if (lastMessage.toLowerCase().includes('who are you')) {
      response = 'I am Thatgfsj Code, an AI assistant built with Node.js. I can help you with coding, file operations, shell commands, and more!';
    } else if (lastMessage.toLowerCase().includes('help')) {
      response = `I can help you with:

📁 File Operations
  - Read, write, and manage files
  - Search for code patterns

🔧 Shell Commands
  - Execute system commands
  - Run build scripts

💻 Code Assistance
  - Explain code
  - Write new code
  - Debug issues

Just tell me what you need!`;
    } else {
      response = `I understand you said: "${lastMessage}"

This is a demo response. To enable full AI capabilities:
1. Run "thatgfsj init" to create config
2. Set your API key: export OPENAI_API_KEY=your_key
3. Or use MiniMax API key

How can I help you further?`;
    }

    return {
      content: response,
      role: 'assistant'
    };
  }
}

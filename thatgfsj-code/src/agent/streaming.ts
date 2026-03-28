/**
 * Streaming Output
 * Handles real-time streaming output with typewriter effect
 */

import chalk from 'chalk';

export type StreamCallback = (chunk: string) => void;
export type DoneCallback = (full: string) => void;

export class StreamingOutput {
  private fullContent: string = '';
  private isStreaming: boolean = false;
  private onChunk?: StreamCallback;
  private onDone?: DoneCallback;
  private buffer: string = '';
  private minChunkDelay: number = 10; // ms between chunks

  /**
   * Start streaming mode
   */
  start(callbacks?: { onChunk?: StreamCallback; onDone?: DoneCallback }): void {
    this.fullContent = '';
    this.isStreaming = true;
    this.onChunk = callbacks?.onChunk;
    this.onDone = callbacks?.onDone;
  }

  /**
   * Process a chunk of content
   */
  processChunk(chunk: string): void {
    if (!this.isStreaming) return;

    this.fullContent += chunk;
    this.buffer += chunk;

    // Flush buffer periodically
    if (this.buffer.length > 0) {
      const toPrint = this.buffer;
      this.buffer = '';

      if (this.onChunk) {
        this.onChunk(toPrint);
      } else {
        process.stdout.write(toPrint);
      }
    }
  }

  /**
   * End streaming mode
   */
  end(): string {
    this.isStreaming = false;

    // Flush remaining buffer
    if (this.buffer.length > 0) {
      if (this.onChunk) {
        this.onChunk(this.buffer);
      } else {
        process.stdout.write(this.buffer);
      }
      this.buffer = '';
    }

    if (this.onDone) {
      this.onDone(this.fullContent);
    }

    return this.fullContent;
  }

  /**
   * Stop streaming (for interrupt)
   */
  stop(): string {
    this.isStreaming = false;
    return this.fullContent;
  }

  /**
   * Get full content so far
   */
  getContent(): string {
    return this.fullContent;
  }

  /**
   * Check if streaming
   */
  isActive(): boolean {
    return this.isStreaming;
  }

  /**
   * Print with typewriter effect (for interactive mode)
   */
  static async typewriter(
    text: string,
    delay: number = 20,
    onChunk?: (chunk: string) => void
  ): Promise<void> {
    for (let i = 0; i < text.length; i++) {
      process.stdout.write(text[i]);
      if (onChunk) onChunk(text[i]);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  /**
   * Print code block with syntax highlighting hint
   */
  static printCodeBlock(code: string, language: string = ''): void {
    const lines = code.split('\n');
    const maxLen = Math.max(...lines.map(l => l.length), 60);

    console.log(chalk.bgBlack.gray('┌' + '─'.repeat(Math.min(maxLen, 80)) + '┐'));
    
    if (language) {
      console.log(chalk.bgBlack.gray('│ ') + chalk.cyan(language) + chalk.bgBlack.gray(' '.repeat(Math.max(0, maxLen - language.length - 1))) + chalk.bgBlack.gray('│'));
      console.log(chalk.bgBlack.gray('├' + '─'.repeat(Math.min(maxLen, 80)) + '┤'));
    }

    for (const line of lines) {
      const displayLine = line.length > maxLen ? line.substring(0, maxLen - 3) + '...' : line;
      console.log(chalk.bgBlack('│ ') + displayLine + ' '.repeat(Math.max(0, maxLen - displayLine.length)) + chalk.bgBlack(' │'));
    }

    console.log(chalk.bgBlack.gray('└' + '─'.repeat(Math.min(maxLen, 80)) + '┘'));
  }
}

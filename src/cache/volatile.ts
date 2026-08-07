/**
 * VolatileScratch — per-round reasoning / planning state that MUST NOT be
 * uploaded to the API.
 *
 * Reasonix Principle #3 (Volatile Scratch):
 *   The model's thinking content, intermediate plans, and other
 *   intra-round state should never be appended to the conversation
 *   history. They are useful for the UI (so users can debug / audit
 *   reasoning) and for cross-iteration handoff within the same round
 *   (e.g. retry-after-tool-failure), but they are NOT part of the cache
 *   prefix and re-uploading them in the next round would:
 *     1. waste tokens (potentially a lot — reasoning can dwarf the answer)
 *     2. cause context-window pressure
 *     3. risk leaking partial / contradictory reasoning back to the model
 *
 * Usage (in LLMService / useChat when receiving 'thinking' chunks):
 *   scratch.write(chunk.content);
 *   // ... later in the same round ...
 *   scratch.read(); // → joined reasoning so far
 *   scratch.reset(); // → call at end of round OR on /new
 */
export class VolatileScratch {
  private current: string[] = [];

  reset(): void {
    this.current = [];
  }

  write(data: string): void {
    if (!data) return;
    this.current.push(data);
  }

  read(): string {
    return this.current.join('\n');
  }

  /** True when no scratch has been written since the last reset. */
  isEmpty(): boolean {
    return this.current.length === 0;
  }

  /** Number of segments written. Useful for UI display ("thought for N lines"). */
  size(): number {
    return this.current.length;
  }
}

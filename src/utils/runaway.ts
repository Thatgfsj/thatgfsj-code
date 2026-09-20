/**
 * v3.3.0 runaway guard (idea adopted from MiniMax mcode's runaway-guard,
 * MIT — reimplemented, not copied): fingerprint every tool call within a
 * turn; when the SAME call repeats, inject a soft system reminder so the
 * model breaks out of the loop instead of burning rounds until
 * maxIterations. Soft nudge, never a hard stop — legitimate retries (a
 * flaky network browser call) must keep working.
 */
export interface RunawayVerdict {
  /** How many times this exact call has repeated this turn (1-based). */
  count: number;
  /** True when a system reminder should be injected this round. */
  remind: boolean;
}

export interface RunawayGuard {
  track(toolName: string, argsJson: string): RunawayVerdict;
  reset(): void;
}

/** Every Nth repeat triggers a reminder (3rd, 6th, …). */
const REMIND_EVERY = 3;

export function createRunawayGuard(): RunawayGuard {
  const counts = new Map<string, number>();
  return {
    track(toolName: string, argsJson: string): RunawayVerdict {
      const key = `${toolName}::${argsJson}`;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { count: n, remind: n >= REMIND_EVERY && n % REMIND_EVERY === 0 };
    },
    reset(): void {
      counts.clear();
    },
  };
}

/**
 * Built-in shared SiliconFlow model (v3.1.2).
 *
 * Ships a working out-of-box model for fresh installs: when no user API key
 * is configured, the CLI talks to SiliconFlow with the shared key embedded
 * here. The key material is stored as XOR-scrambled, chunk-permuted number
 * fragments — no plaintext anywhere in the package and no "decrypt"
 * function; revealBuiltinKey() reassembles it in memory per call and
 * self-checks the SHA-256 so a tampered/mistyped fragment set fails fast.
 *
 * NOTE (honest limit): obfuscation is NOT cryptographic protection. Anyone
 * determined can extract a working credential from a distributed client.
 * Treat this key as an expendable, rotatable quota pool.
 */

import { createHash } from 'crypto';

export const BUILTIN_MODEL_ID = 'Qwen/Qwen3.5-4B';
export const BUILTIN_PROVIDER = 'siliconflow' as const;

const XOR_BASE = 90;
const STRIDE = 7;
const MOD = 251;

const FRAGMENTS: ReadonlyArray<ReadonlyArray<number>> = [
    [18,27,7,232,225,242,236,209,217,198,194,207],
    [114,123,112,71,84,69,67,45,36,34,54,6,2],
    [193,207,169,187,162,174,184,148,132,140,159,106,113],
    [41,10,69,28,20,16,232,239,253,253,216,201,193]
];

/** SHA-256 of the assembled key — integrity self-check. */
const KEY_HASH = '3642db5b92e666dea68e2b630cc3b0f3f29c24cb64353b722067c40b51116e53';

let cached: string | null = null;

/** Reassemble the shared key in memory (never logged, never persisted). */
export function revealBuiltinKey(): string {
  if (cached) return cached;
  const flat = [...FRAGMENTS].reverse().flat();
  const key = flat
    .map((b, i) => String.fromCharCode((b ^ ((XOR_BASE + ((i * STRIDE) % MOD)) & 0xFF)) & 0xFF))
    .join('');
  const hash = createHash('sha256').update(key).digest('hex');
  if (hash !== KEY_HASH) {
    throw new Error('Built-in key fragments failed integrity check');
  }
  cached = key;
  return key;
}

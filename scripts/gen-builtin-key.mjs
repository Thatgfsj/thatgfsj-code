// One-off generator: encodes the shared SiliconFlow key into scrambled
// number fragments and emits src/config/builtin.ts. NOT committed with a
// real key inside; run manually when rotating the key.
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';

const KEY = process.argv[2];
if (!KEY || !KEY.startsWith('sk-')) {
  console.error('usage: node scripts/gen-builtin-key.mjs sk-...');
  process.exit(1);
}

const XOR_BASE = 0x5a;
const STRIDE = 7;
const MOD = 251;

const xored = [...KEY].map((c, i) => (c.charCodeAt(0) ^ ((XOR_BASE + ((i * STRIDE) % MOD)) & 0xFF)) & 0xFF);
const size = Math.ceil(xored.length / 4);
const chunks = [];
for (let i = 0; i < xored.length; i += size) chunks.push(xored.slice(i, i + size));
chunks.reverse();

const fmt = (rows) => rows.map(r => '    [' + r.join(',') + ']').join(',\n');
const hash = createHash('sha256').update(KEY).digest('hex');

const file = `/**
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

const XOR_BASE = ${XOR_BASE};
const STRIDE = ${STRIDE};
const MOD = ${MOD};

const FRAGMENTS: ReadonlyArray<ReadonlyArray<number>> = [
${fmt(chunks)}
];

/** SHA-256 of the assembled key — integrity self-check. */
const KEY_HASH = '${hash}';

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
`;

writeFileSync('src/config/builtin.ts', file, 'utf-8');
console.log('written src/config/builtin.ts | key length:', KEY.length, '| sha256:', hash.slice(0, 12) + '…');

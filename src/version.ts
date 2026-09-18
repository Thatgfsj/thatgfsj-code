/**
 * Single source of truth for the version string.
 *
 * v3.0.5: the version used to be hardcoded in four places (package.json,
 * cmd/index.tsx --version, tui/components/Header.tsx, tui/welcome.ts) and
 * drifted (3.0.4 / 0.5.0 / v3.0.4 / v0.5.0 were all visible at once).
 * Everything now reads from package.json at runtime via createRequire —
 * package.json is always included in the npm tarball, so this works both
 * from a git checkout and from the published package.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | null = null;

export function getVersion(): string {
  if (cached) return cached;
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const raw = require(pkgPath);
    cached = typeof raw?.version === 'string' && raw.version ? raw.version : '0.0.0';
  } catch {
    cached = '0.0.0';
  }
  return cached ?? '0.0.0';
}

import { describe, it, expect } from 'vitest';
import { fingerprint, fingerprintTools, fingerprintSystemPrefix } from '../../src/cache/fingerprint.js';
import type { Tool } from '../../src/tools/types.js';
import type { SystemSegment } from '../../src/prompts/index.js';

describe('fingerprint', () => {
  it('returns same hash for structurally equal objects', () => {
    const a = { name: 'file', description: 'Read files', inputSchema: { type: 'object' } };
    const b = { inputSchema: { type: 'object' }, description: 'Read files', name: 'file' };
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('returns different hash for different content', () => {
    expect(fingerprint({ name: 'a' })).not.toBe(fingerprint({ name: 'b' }));
  });

  it('returns 16-char hex string', () => {
    const fp = fingerprint({ x: 1 });
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it('fingerprintTools ignores non-wire Tool metadata', () => {
    // Two Tool objects with same name/description/inputSchema but different
    // internal metadata (e.g. version, internal flags) must produce the
    // same fingerprint, because only the three wire fields matter for
    // upstream prompt cache lookup.
    const t1: Tool = {
      name: 'file',
      description: 'Read/write files',
      parameters: [],
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      execute: async () => ({ success: true }),
      // @ts-expect-error: simulate extra internal metadata
      version: '1.0.0',
    };
    const t2: Tool = {
      name: 'file',
      description: 'Read/write files',
      parameters: [],
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      execute: async () => ({ success: true }),
      // @ts-expect-error
      version: '2.0.0',
    };
    expect(fingerprintTools([t1])).toBe(fingerprintTools([t2]));
  });

  it('fingerprintSystemPrefix excludes volatile segments', () => {
    const segments: SystemSegment[] = [
      { name: 'identity', content: 'You are Thatgfsj', volatile: false },
      { name: 'tools', content: '## Tools\nfile, shell', volatile: false },
      { name: 'nwt', content: 'Recent: did X, did Y, did Z', volatile: true },
      { name: 'date', content: '2026-08-08 12:34:56', volatile: true },
    ];
    // Hash should be stable when only the volatile segments change.
    const baseFp = fingerprintSystemPrefix(segments);

    const segmentsMutated: SystemSegment[] = [
      { name: 'identity', content: 'You are Thatgfsj', volatile: false },
      { name: 'tools', content: '## Tools\nfile, shell', volatile: false },
      { name: 'nwt', content: 'Recent: did X, did Y, did ZZZZZZ', volatile: true }, // mutated
      { name: 'date', content: '2099-12-31 00:00:00', volatile: true }, // mutated
    ];
    expect(fingerprintSystemPrefix(segmentsMutated)).toBe(baseFp);

    // But change to an immutable segment should break the hash.
    const segmentsIdentityChanged: SystemSegment[] = [
      { name: 'identity', content: 'You are a different agent', volatile: false },
      { name: 'tools', content: '## Tools\nfile, shell', volatile: false },
      { name: 'nwt', content: 'Recent: did X, did Y, did Z', volatile: true },
      { name: 'date', content: '2026-08-08 12:34:56', volatile: true },
    ];
    expect(fingerprintSystemPrefix(segmentsIdentityChanged)).not.toBe(baseFp);
  });
});

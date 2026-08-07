import { describe, it, expect } from 'vitest';
import { stableStringify } from '../../src/utils/stableStringify.js';

describe('stableStringify', () => {
  it('produces identical output for keys inserted in different orders', () => {
    const a = { name: 'file', description: 'Read files', inputSchema: { type: 'object' } };
    const b = { inputSchema: { type: 'object' }, description: 'Read files', name: 'file' };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('omits undefined values (matches OpenAI/Anthropic wire convention)', () => {
    expect(stableStringify({ a: 1, b: undefined, c: 2 })).toBe(stableStringify({ a: 1, c: 2 }));
  });

  it('handles nested objects recursively', () => {
    const a = { tools: [{ name: 'a', args: { x: 1 } }, { name: 'b', args: { y: 2 } }] };
    const b = { tools: [{ args: { x: 1 }, name: 'a' }, { args: { y: 2 }, name: 'b' }] };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('handles primitives correctly', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('hello')).toBe('"hello"');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify(true)).toBe('true');
    expect(stableStringify(false)).toBe('false');
  });

  it('escapes special characters in strings', () => {
    expect(stableStringify('hello\nworld')).toBe('"hello\\nworld"');
    expect(stableStringify('"quoted"')).toBe('"\\"quoted\\""');
  });

  it('drops NaN and Infinity to null (JSON-incompatible)', () => {
    expect(stableStringify(NaN)).toBe('null');
    expect(stableStringify(Infinity)).toBe('null');
  });

  it('produces empty {} for empty objects and [] for empty arrays', () => {
    expect(stableStringify({})).toBe('{}');
    expect(stableStringify([])).toBe('[]');
  });
});

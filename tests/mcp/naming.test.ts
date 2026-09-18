import { describe, it, expect } from 'vitest';
import { mcpToolName } from '../../src/mcp/client.js';

describe('MCP tool name sanitization', () => {
  it('maps server:tool to a provider-safe mcp__server__tool name', () => {
    expect(mcpToolName('github', 'create_issue')).toBe('mcp__github__create_issue');
  });

  it('replaces characters that would 400 on every provider API', () => {
    // OpenAI: ^[a-zA-Z0-9_-]{1,64}$ — colons, dots, slashes are illegal.
    const name = mcpToolName('my.server', 'search/code:v2');
    expect(name).toBe('mcp__my_server__search_code_v2');
    expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it('caps the length at 64 chars (OpenAI function name limit)', () => {
    const longServer = 'a'.repeat(40);
    const longTool = 'b'.repeat(40);
    const name = mcpToolName(longServer, longTool);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.startsWith('mcp__')).toBe(true);
  });

  it('keeps already-safe names unchanged apart from the prefix', () => {
    expect(mcpToolName('fs', 'read-file')).toBe('mcp__fs__read-file');
  });
});

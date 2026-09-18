/**
 * MCP Client (Model Context Protocol)
 * Connect to MCP servers over stdio and expose their tools as agent tools.
 *
 * v3.0.5 — this module was previously dead code and is now wired into
 * App.create(). Fixes applied while wiring it up:
 *
 *   1. Connection check: `process.connected` is undefined for stdio-spawned
 *      child processes (it only exists for Node IPC channels), so every
 *      request was rejected with "MCP process not connected". We now track
 *      our own `connected` flag set after a successful initialize handshake.
 *   2. Tool naming: `server:tool` contains a colon, which violates the
 *      function-name grammar of all three provider APIs
 *      (^[a-zA-Z0-9_-]{1,64}$) — the very first request carrying an MCP
 *      tool would 400. Names are now `mcp__<server>__<tool>`.
 *   3. Timer hygiene: the 30s connect timeout and per-request timeouts are
 *      now stored, cleared when satisfied, and .unref()'d so they never
 *      keep the event loop alive after the CLI work is done.
 *   4. Schema mapping: `type` is passed through; array/enum details are
 *      folded into the parameter description (our flat ToolParameter shape
 *      cannot express JSON-Schema recursively). Nested object parameters
 *      are declared as JSON-string params and decoded before dispatch.
 */

import { spawn, ChildProcess } from 'child_process';
import type { Tool, ToolResult, ToolContext } from '../tools/types.js';

// ==================== MCP Types ====================

interface MCPJsonRPCRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

interface MCPJsonRPCResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

const REQUEST_TIMEOUT_MS = 30000;
const CONNECT_TIMEOUT_MS = 30000;

/** Both keys are accepted so users can copy configs from Claude Code (mcpServers) or older docs (servers). */
export interface McpConfigFile {
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  servers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

/**
 * Sanitize a server/tool name pair into a provider-safe tool name.
 * All three provider APIs only allow [a-zA-Z0-9_-]; colons would 400.
 */
export function mcpToolName(server: string, tool: string): string {
  const s = server.replace(/[^a-zA-Z0-9_-]/g, '_');
  const t = tool.replace(/[^a-zA-Z0-9_-]/g, '_');
  const name = `mcp__${s}__${t}`;
  // OpenAI caps function names at 64 chars.
  return name.length <= 64 ? name : name.slice(0, 64);
}

// ==================== MCP Client ====================

export class MCPClient {
  private process: ChildProcess | null = null;
  private tools: Map<string, MCPTool> = new Map();
  private requestId = 0;
  private pendingRequests: Map<number | string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer?: ReturnType<typeof setTimeout>;
  }> = new Map();
  private name: string;
  private connected = false;
  private connectTimer?: ReturnType<typeof setTimeout>;
  /** Original tool name keyed by sanitized name, for dispatch back to the server. */
  private nameMap: Map<string, string> = new Map();

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Connect to an MCP server over stdio.
   * @param command Command to run (e.g., 'npx', 'node')
   * @param args Arguments (e.g., ['-y', '@modelcontextprotocol/server-filesystem', '/path'])
   * @param env Extra environment variables for the child process
   */
  async connect(command: string, args: string[], env?: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (this.connectTimer) {
          clearTimeout(this.connectTimer);
          this.connectTimer = undefined;
        }
        if (err) reject(err);
        else resolve();
      };

      this.connectTimer = setTimeout(() => {
        settle(new Error(`MCP server "${this.name}" connection timeout (${CONNECT_TIMEOUT_MS / 1000}s)`));
      }, CONNECT_TIMEOUT_MS);
      this.connectTimer.unref?.();

      let child: ChildProcess;
      try {
        child = spawn(command, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: env ? { ...process.env, ...env } : process.env,
          windowsHide: true,
        });
      } catch (err: any) {
        settle(new Error(`MCP server "${this.name}" failed to spawn ${command}: ${err.message}`));
        return;
      }
      this.process = child;

      let buffer = '';

      child.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) this.handleMessage(line);
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        // MCP servers commonly log to stderr; surface it without crashing.
        process.stderr.write(`[mcp:${this.name}] ${data.toString().trim()}\n`);
      });

      child.on('error', (err) => {
        this.connected = false;
        settle(new Error(`MCP server "${this.name}" process error: ${err.message}`));
      });

      child.on('close', (code) => {
        this.connected = false;
        // Reject every in-flight request so callers never hang on a dead server.
        for (const [, pending] of this.pendingRequests) {
          if (pending.timer) clearTimeout(pending.timer);
          pending.reject(new Error(`MCP server "${this.name}" exited (code ${code})`));
        }
        this.pendingRequests.clear();
      });

      // Initialize handshake. Success gates `connected`, which gates every
      // subsequent sendRequest.
      this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'thatgfsj-code', version: '3.0.5' },
      }).then(async () => {
        this.connected = true;
        this.sendNotification('initialized', {});
        try {
          await this.listTools();
        } catch {
          // A server with zero tools is still a successful connection.
        }
        settle();
      }).catch((err) => {
        settle(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  /**
   * Handle incoming JSON-RPC message
   */
  private handleMessage(raw: string): void {
    try {
      const msg: MCPJsonRPCResponse = JSON.parse(raw);

      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (pending.timer) clearTimeout(pending.timer);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
    } catch {
      // Not JSON, ignore
    }
  }

  /**
   * Send a JSON-RPC request
   */
  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      // v3.0.5: the old check read `this.process?.connected`, which is
      // undefined for stdio spawns — every request failed. Gate on our own
      // handshake flag instead (except for `initialize` itself, which runs
      // before the flag is set).
      if (!this.process || !this.process.stdin || (method !== 'initialize' && !this.connected)) {
        reject(new Error(`MCP server "${this.name}" is not connected`));
        return;
      }

      const id = ++this.requestId;
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();

      this.pendingRequests.set(id, { resolve, reject, timer });

      const request: MCPJsonRPCRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.process.stdin.write(JSON.stringify(request) + '\n', (err) => {
        if (err) {
          this.pendingRequests.delete(id);
          if (timer) clearTimeout(timer);
          reject(new Error(`MCP write failed: ${err.message}`));
        }
      });
    });
  }

  /**
   * Send a notification (no response expected)
   */
  private sendNotification(method: string, params: any): void {
    if (!this.process || !this.process.stdin || !this.connected) return;
    this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  /**
   * Call an MCP tool (by its ORIGINAL server-side name)
   */
  async callTool(name: string, arguments_: Record<string, any>): Promise<ToolResult> {
    try {
      const result = await this.sendRequest('tools/call', {
        name,
        arguments: arguments_,
      });

      // MCP tool results are content blocks: [{type:'text', text:'...'}, ...]
      let output: string;
      if (typeof result === 'string') {
        output = result;
      } else if (Array.isArray(result?.content)) {
        output = result.content
          .map((block: any) => (block.type === 'text' ? block.text : JSON.stringify(block)))
          .join('\n');
      } else {
        output = JSON.stringify(result ?? null);
      }

      return { success: result?.isError ? false : true, output };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * List tools from the server and refresh the local registry
   */
  private async listTools(): Promise<void> {
    const result = await this.sendRequest('tools/list', {});
    const tools: MCPTool[] = result.tools || [];

    this.tools.clear();
    this.nameMap.clear();
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
      this.nameMap.set(mcpToolName(this.name, tool.name), tool.name);
    }
  }

  /**
   * Get registered tools as agent Tool[] with provider-safe names.
   *
   * v3.0.5 fix: MCP tools route through the same permission gate as built-in
   * tools — previously execute() dropped the ctx, so in 'ask' mode any MCP
   * write/execute tool ran without confirmation (contradicting the
   * fail-closed design promise).
   */
  getTools(): Tool[] {
    return [...this.tools.values()].map(mcpTool => {
      const exposedName = mcpToolName(this.name, mcpTool.name);
      return {
        name: exposedName,
        description: mcpTool.description || `(MCP tool ${this.name}/${mcpTool.name})`,
        parameters: this.mapParameters(mcpTool),
        execute: async (params: Record<string, any>, ctx?: ToolContext): Promise<ToolResult> => {
          if (ctx?.confirmAction) {
            const argPreview = Object.keys(params).length > 0
              ? ` ${JSON.stringify(params).slice(0, 100)}`
              : '';
            const ok = await ctx.confirmAction(`调用 MCP 工具 ${exposedName}${argPreview}`);
            if (!ok) {
              return { success: false, error: 'MCP tool call cancelled by user' };
            }
          } else {
            return { success: false, error: 'MCP tool call requires confirmation, but no confirmation channel is available (headless? add --yolo)' };
          }
          // JSON-string params for nested object schemas are decoded here.
          const decoded = this.decodeParams(mcpTool, params);
          return this.callTool(mcpTool.name, decoded);
        },
      };
    });
  }

  /**
   * Map a JSON Schema to our flat ToolParameter list. `type` passes through;
   * arrays/enums are described in text; nested objects become JSON-string
   * params (decoded in decodeParams).
   */
  private mapParameters(mcpTool: MCPTool) {
    const required = new Set(mcpTool.inputSchema.required || []);
    return Object.entries(mcpTool.inputSchema.properties || {}).map(([name, schema]: [string, any]) => {
      let type = typeof schema.type === 'string' ? schema.type : 'string';
      let description = schema.description || '';
      if (type === 'array') {
        type = 'string';
        description += ' (JSON array string, e.g. ["a","b"])';
      } else if (type === 'object') {
        type = 'string';
        description += ' (JSON object string, e.g. {"key":"value"})';
      }
      if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        description += ` (one of: ${schema.enum.join(', ')})`;
      }
      if (schema.items?.type) {
        description += ` [array items: ${schema.items.type}]`;
      }
      return { name, type, description: description.trim(), required: required.has(name) };
    });
  }

  /** Decode JSON-string params back into real values for object/array schemas. */
  private decodeParams(mcpTool: MCPTool, params: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = { ...params };
    for (const [name, schema] of Object.entries(mcpTool.inputSchema.properties || {})) {
      const t = (schema as any)?.type;
      const v = out[name];
      if ((t === 'object' || t === 'array') && typeof v === 'string') {
        try { out[name] = JSON.parse(v); } catch { /* keep raw string; server will report the error */ }
      }
    }
    return out;
  }

  /** Original server-side tool name for an exposed (sanitized) name. */
  resolveToolName(exposedName: string): string | undefined {
    return this.nameMap.get(exposedName);
  }

  getToolNames(): string[] {
    return [...this.tools.keys()];
  }

  isConnected(): boolean {
    return this.connected;
  }

  getServerName(): string {
    return this.name;
  }

  disconnect(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
    }
    for (const [, pending] of this.pendingRequests) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(`MCP server "${this.name}" disconnected`));
    }
    this.pendingRequests.clear();
    if (this.process) {
      try {
        this.process.kill();
      } catch { /* already dead */ }
      this.process = null;
    }
    this.connected = false;
    this.tools.clear();
    this.nameMap.clear();
  }
}

// ==================== MCP Server Manager ====================

export class MCPServerManager {
  private clients: Map<string, MCPClient> = new Map();

  /**
   * Load servers from a config object and connect to each. A failing server
   * is reported but never blocks startup — one broken MCP server must not
   * take the whole CLI down.
   *
   * @returns per-server connect results for the /mcp command and startup log
   */
  async connectFromConfig(config: McpConfigFile): Promise<Array<{ name: string; ok: boolean; error?: string; tools: number }>> {
    const servers = config.mcpServers || config.servers || {};
    const results: Array<{ name: string; ok: boolean; error?: string; tools: number }> = [];

    for (const [name, def] of Object.entries(servers)) {
      if (!def || typeof def.command !== 'string' || !def.command.trim()) {
        results.push({ name, ok: false, error: 'missing "command"', tools: 0 });
        continue;
      }
      const client = new MCPClient(name);
      try {
        await client.connect(def.command, def.args || [], def.env);
        this.clients.set(name, client);
        results.push({ name, ok: true, tools: client.getToolNames().length });
      } catch (err: any) {
        // v3.0.5 fix: kill the spawned child on failed handshake — otherwise
        // the server process lingers as an orphan (it never joins
        // this.clients, so disconnectAll can not reap it).
        try { client.disconnect(); } catch { /* best-effort */ }
        results.push({ name, ok: false, error: err.message, tools: 0 });
      }
    }
    return results;
  }

  /** Get all tools from all connected servers, with provider-safe names. */
  getAllTools(): Tool[] {
    const allTools: Tool[] = [];
    for (const client of this.clients.values()) {
      allTools.push(...client.getTools());
    }
    return allTools;
  }

  removeServer(name: string): void {
    const client = this.clients.get(name);
    if (client) {
      client.disconnect();
      this.clients.delete(name);
    }
  }

  disconnectAll(): void {
    for (const client of this.clients.values()) {
      client.disconnect();
    }
    this.clients.clear();
  }

  /**
   * Status report for the /mcp command.
   */
  getStatus(): Array<{ name: string; connected: boolean; tools: string[] }> {
    return [...this.clients.values()].map(c => ({
      name: c.getServerName(),
      connected: c.isConnected(),
      tools: c.getToolNames(),
    }));
  }
}

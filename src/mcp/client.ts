/**
 * S07: MCP Client (Model Context Protocol)
 * Connect to MCP servers and expose their tools as agent tools
 * 
 * MCP turns the agent from a closed system into an open platform.
 * Any server can expose tools via the MCP JSON-RPC 2.0 protocol.
 */

import { spawn, ChildProcess } from 'child_process';
import { Tool, ToolResult } from '../core/types.js';

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

// ==================== MCP Client ====================

export class MCPClient {
  private process: ChildProcess | null = null;
  private tools: Map<string, MCPTool> = new Map();
  private requestId = 0;
  private pendingRequests: Map<number | string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }> = new Map();
  private name: string;
  private connected = false;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * S07: Connect to an MCP server
   * @param command Command to run (e.g., 'npx', 'node')
   * @param args Arguments (e.g., ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/dir'])
   */
  async connect(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let buffer = '';

      this.process.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            this.handleMessage(line);
          }
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        console.error(`[MCP ${this.name}] stderr:`, data.toString().trim());
      });

      this.process.on('error', (err) => {
        reject(err);
      });

      this.process.on('close', (code) => {
        this.connected = false;
        console.log(`[MCP ${this.name}] exited with code ${code}`);
      });

      // Initialize MCP connection
      this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'thatgfsj-code', version: '1.0.0' }
      }).then(() => {
        this.connected = true;
        // Send initialized notification
        this.sendNotification('initialized', {});
        // List available tools
        return this.listTools();
      }).then(() => {
        resolve();
      }).catch(reject);

      // Timeout
      setTimeout(() => reject(new Error('MCP connection timeout')), 30000);
    });
  }

  /**
   * S07: Handle incoming JSON-RPC message
   */
  private handleMessage(raw: string): void {
    try {
      const msg: MCPJsonRPCResponse = JSON.parse(raw);

      // Handle response
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
        return;
      }
    } catch {
      // Not JSON, ignore
    }
  }

  /**
   * S07: Send a JSON-RPC request
   */
  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process?.connected) {
        reject(new Error('MCP process not connected'));
        return;
      }

      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });

      const request: MCPJsonRPCRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.process.stdin?.write(JSON.stringify(request) + '\n');

      // Timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('MCP request timeout: ' + method));
        }
      }, 30000);
    });
  }

  /**
   * S07: Send a notification (no response expected)
   */
  private sendNotification(method: string, params: any): void {
    if (!this.process?.connected) return;

    const notification = {
      jsonrpc: '2.0',
      method,
      params
    };

    this.process.stdin?.write(JSON.stringify(notification) + '\n');
  }

  /**
   * S07: Call an MCP tool
   */
  async callTool(name: string, arguments_: Record<string, any>): Promise<ToolResult> {
    try {
      const result = await this.sendRequest('tools/call', {
        name,
        arguments: arguments_
      });

      return {
        success: true,
        output: typeof result === 'string' ? result : JSON.stringify(result)
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * S07: List tools from MCP server
   */
  private async listTools(): Promise<void> {
    try {
      const result = await this.sendRequest('tools/list', {});
      const tools: MCPTool[] = result.tools || [];

      this.tools.clear();
      for (const tool of tools) {
        this.tools.set(tool.name, tool);
      }

      console.log(`[MCP ${this.name}] Loaded ${tools.length} tools:`, [...this.tools.keys()].join(', '));
    } catch (error: any) {
      console.error(`[MCP ${this.name}] Failed to list tools:`, error.message);
    }
  }

  /**
   * S07: Get registered tools as agent Tool[]
   */
  getTools(): Tool[] {
    return [...this.tools.values()].map(mcpTool => ({
      name: this.name + ':' + mcpTool.name,
      description: mcpTool.description,
      parameters: Object.entries(mcpTool.inputSchema.properties || {}).map(([name, schema]: [string, any]) => ({
        name,
        type: schema.type || 'string',
        description: schema.description || '',
        required: (mcpTool.inputSchema.required || []).includes(name)
      })),
      execute: async (params: Record<string, any>): Promise<ToolResult> => {
        return this.callTool(mcpTool.name, params);
      }
    }));
  }

  /**
   * S07: Get tool names
   */
  getToolNames(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * S07: Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * S07: Disconnect from MCP server
   */
  disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
    this.tools.clear();
    this.pendingRequests.clear();
  }
}

// ==================== MCP Server Manager ====================

export class MCPServerManager {
  private clients: Map<string, MCPClient> = new Map();

  /**
   * S07: Add and connect an MCP server
   */
  async addServer(name: string, command: string, args: string[]): Promise<void> {
    const client = new MCPClient(name);
    await client.connect(command, args);
    this.clients.set(name, client);
  }

  /**
   * S07: Get all tools from all servers
   */
  getAllTools(): Tool[] {
    const allTools: Tool[] = [];
    for (const client of this.clients.values()) {
      allTools.push(...client.getTools());
    }
    return allTools;
  }

  /**
   * S07: Get tool names from all servers
   */
  getAllToolNames(): string[] {
    const names: string[] = [];
    for (const [serverName, client] of this.clients) {
      for (const toolName of client.getToolNames()) {
        names.push(serverName + ':' + toolName);
      }
    }
    return names;
  }

  /**
   * S07: Disconnect a server
   */
  removeServer(name: string): void {
    const client = this.clients.get(name);
    if (client) {
      client.disconnect();
      this.clients.delete(name);
    }
  }

  /**
   * S07: Get server status
   */
  getStatus(): Record<string, boolean> {
    const status: Record<string, boolean> = {};
    for (const [name, client] of this.clients) {
      status[name] = client.isConnected();
    }
    return status;
  }
}

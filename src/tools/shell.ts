/**
 * Shell Tool - Execute shell commands
 */

import { Tool, ToolResult } from '../core/types.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ShellTool implements Tool {
  name = 'shell';
  description = 'Execute shell commands and scripts';
  
  parameters = [
    { name: 'command', type: 'string', description: 'Shell command to execute', required: true },
    { name: 'cwd', type: 'string', description: 'Working directory', required: false },
    { name: 'timeout', type: 'number', description: 'Timeout in seconds', required: false }
  ];

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const { command, cwd, timeout = 30 } = params;
    
    if (!command) {
      return { success: false, error: 'Command is required' };
    }

    try {
      // Security: whitelist dangerous commands
      const dangerous = ['rm -rf /', 'format c:', 'del /f /s /q c:'];
      for (const d of dangerous) {
        if (command.toLowerCase().includes(d.toLowerCase())) {
          return { success: false, error: `Dangerous command blocked: ${d}` };
        }
      }

      const options: any = { 
        timeout: timeout * 1000,
        maxBuffer: 10 * 1024 * 1024 // 10MB
      };
      
      if (cwd) {
        options.cwd = cwd;
      }

      const { stdout, stderr } = await execAsync(command, options);
      const stdoutStr = stdout?.toString() || '';
      const stderrStr = stderr?.toString() || '';
      
      if (stderrStr && !stderrStr.includes('warning')) {
        return { 
          success: true, 
          output: stdoutStr || stderrStr 
        };
      }
      
      return { success: true, output: stdoutStr };
      
    } catch (error: any) {
      return { 
        success: false, 
        error: error.message || 'Command execution failed' 
      };
    }
  }
}

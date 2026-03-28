/**
 * Git Tool - Git operations
 */

import { Tool, ToolResult } from '../core/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

export class GitTool implements Tool {
  name = 'git';
  description = 'Git operations: status, log, diff, commit, branch, etc.';
  
  parameters = [
    { name: 'action', type: 'string', description: 'Git action: status, log, diff, commit, branch, checkout, pull, push', required: true },
    { name: 'args', type: 'string', description: 'Additional arguments', required: false },
    { name: 'message', type: 'string', description: 'Commit message (for commit action)', required: false },
    { name: 'cwd', type: 'string', description: 'Working directory', required: false }
  ];

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const { action, args, message, cwd } = params;
    const workDir = cwd || process.cwd();
    
    // Check if git repo exists
    if (!existsSync(`${workDir}/.git`)) {
      return { success: false, error: 'Not a git repository' };
    }
    
    try {
      switch (action) {
        case 'status':
          return await this.status(workDir);
        case 'log':
          return await this.log(workDir, args || '10');
        case 'diff':
          return await this.diff(workDir, args || '');
        case 'commit':
          return await this.commit(workDir, message || args);
        case 'branch':
          return await this.branch(workDir);
        case 'checkout':
          return await this.checkout(workDir, args);
        case 'pull':
          return await this.pull(workDir);
        case 'push':
          return await this.push(workDir);
        case 'add':
          return await this.add(workDir, args || '.');
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async status(cwd: string): Promise<ToolResult> {
    const { stdout } = await execAsync('git status --short', { cwd });
    return { success: true, output: stdout || '(clean)' };
  }

  private async log(cwd: string, limit: string): Promise<ToolResult> {
    const { stdout } = await execAsync(`git log --oneline -n ${limit}`, { cwd });
    return { success: true, output: stdout || 'No commits yet' };
  }

  private async diff(cwd: string, args: string): Promise<ToolResult> {
    const { stdout } = await execAsync(`git diff ${args}`, { cwd });
    return { success: true, output: stdout || 'No changes' };
  }

  private async commit(cwd: string, message: string): Promise<ToolResult> {
    if (!message) {
      return { success: false, error: 'Commit message required' };
    }
    
    // Stage all changes
    await execAsync('git add -A', { cwd });
    
    const { stdout } = await execAsync(`git commit -m "${message}"`, { cwd });
    return { success: true, output: stdout || 'Committed successfully' };
  }

  private async branch(cwd: string): Promise<ToolResult> {
    const { stdout } = await execAsync('git branch -a', { cwd });
    return { success: true, output: stdout };
  }

  private async checkout(cwd: string, branch: string): Promise<ToolResult> {
    if (!branch) {
      return { success: false, error: 'Branch name required' };
    }
    
    const { stdout } = await execAsync(`git checkout ${branch}`, { cwd });
    return { success: true, output: stdout };
  }

  private async pull(cwd: string): Promise<ToolResult> {
    const { stdout } = await execAsync('git pull', { cwd });
    return { success: true, output: stdout };
  }

  private async push(cwd: string): Promise<ToolResult> {
    const { stdout } = await execAsync('git push', { cwd });
    return { success: true, output: stdout };
  }

  private async add(cwd: string, files: string): Promise<ToolResult> {
    const { stdout } = await execAsync(`git add ${files}`, { cwd });
    return { success: true, output: stdout || 'Added successfully' };
  }
}

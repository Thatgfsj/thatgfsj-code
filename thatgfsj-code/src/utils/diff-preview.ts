/**
 * Diff Preview - Show file changes before modification
 * Simple implementation without external dependencies
 */

import { readFileSync, existsSync } from 'fs';

export interface DiffResult {
  hasChanges: boolean;
  oldContent?: string;
  newContent?: string;
  diff?: string;
  preview?: string;
}

export class DiffPreview {
  /**
   * Compare old and new content and generate diff
   */
  static compare(oldContent: string, newContent: string): DiffResult {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    const diff = this.computeDiff(oldLines, newLines);
    
    if (diff.length === 0) {
      return { hasChanges: false };
    }

    return {
      hasChanges: true,
      oldContent,
      newContent,
      diff: this.formatDiff(diff),
      preview: this.formatPreview(diff)
    };
  }

  /**
   * Compute simple line-by-line diff
   */
  private static computeDiff(oldLines: string[], newLines: string[]): DiffChunk[] {
    const result: DiffChunk[] = [];
    
    // Simple LCS-based diff
    const lcs = this.longestCommonSubsequence(oldLines, newLines);
    
    let oldIdx = 0;
    let newIdx = 0;
    let lcsIdx = 0;
    
    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      if (lcsIdx < lcs.length) {
        // Output removed lines from old
        while (oldIdx < oldLines.length && oldLines[oldIdx] !== lcs[lcsIdx]) {
          result.push({ type: 'removed', content: oldLines[oldIdx] });
          oldIdx++;
        }
        
        // Output added lines from new
        while (newIdx < newLines.length && newLines[newIdx] !== lcs[lcsIdx]) {
          result.push({ type: 'added', content: newLines[newIdx] });
          newIdx++;
        }
        
        // Output common line
        if (oldIdx < oldLines.length && newIdx < newLines.length) {
          result.push({ type: 'unchanged', content: oldLines[oldIdx] });
          oldIdx++;
          newIdx++;
          lcsIdx++;
        }
      } else {
        // Remaining lines
        while (oldIdx < oldLines.length) {
          result.push({ type: 'removed', content: oldLines[oldIdx] });
          oldIdx++;
        }
        while (newIdx < newLines.length) {
          result.push({ type: 'added', content: newLines[newIdx] });
          newIdx++;
        }
      }
    }
    
    return result;
  }

  /**
   * Find longest common subsequence
   */
  private static longestCommonSubsequence(a: string[], b: string[]): string[] {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    
    // Backtrack to find LCS
    const lcs: string[] = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        lcs.unshift(a[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }
    
    return lcs;
  }

  /**
   * Show diff between file and proposed changes
   */
  static diffFile(filePath: string, newContent: string): DiffResult {
    let oldContent = '';
    
    if (existsSync(filePath)) {
      try {
        oldContent = readFileSync(filePath, 'utf-8');
      } catch {
        // File exists but can't read
      }
    }
    
    return this.compare(oldContent, newContent);
  }

  /**
   * Format diff for display with colors
   */
  private static formatDiff(diff: DiffChunk[]): string {
    const lines: string[] = [];
    const green = '\x1b[32m';
    const red = '\x1b[31m';
    const gray = '\x1b[90m';
    const reset = '\x1b[0m';
    
    for (const chunk of diff) {
      if (chunk.type === 'added') {
        lines.push(`${green}+ ${chunk.content}${reset}`);
      } else if (chunk.type === 'removed') {
        lines.push(`${red}- ${chunk.content}${reset}`);
      } else {
        lines.push(`${gray}  ${chunk.content}${reset}`);
      }
    }
    
    return lines.join('\n');
  }

  /**
   * Format a compact preview
   */
  private static formatPreview(diff: DiffChunk[]): string {
    let added = 0;
    let removed = 0;
    
    for (const chunk of diff) {
      if (chunk.type === 'added') added++;
      if (chunk.type === 'removed') removed++;
    }
    
    const parts: string[] = [];
    if (added > 0) parts.push(`+${added}`);
    if (removed > 0) parts.push(`-${removed}`);
    
    return parts.join(' ') || 'No changes';
  }

  /**
   * Check if changes are significant
   */
  static isSignificant(oldContent: string, newContent: string, threshold: number = 0.1): boolean {
    if (!oldContent && !newContent) return false;
    if (!oldContent || !newContent) return true;
    
    const oldLines = oldContent.split('\n').length;
    const newLines = newContent.split('\n').length;
    
    const changeRatio = Math.abs(newLines - oldLines) / oldLines;
    return changeRatio > threshold;
  }
}

interface DiffChunk {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
}

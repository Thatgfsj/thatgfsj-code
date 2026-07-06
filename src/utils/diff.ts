/**
 * Diff Preview - Show file changes in a readable format
 * Migrated from old src/utils/diff-preview.ts
 */

export interface DiffResult {
  original: string;
  modified: string;
  diff: string;
  added: number;
  removed: number;
}

export class DiffPreview {
  /**
   * Generate a simple line-by-line diff
   */
  static diff(original: string, modified: string): DiffResult {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');
    const diffLines: string[] = [];
    let added = 0;
    let removed = 0;

    // Simple diff: show removed (-) and added (+) lines
    const maxLen = Math.max(originalLines.length, modifiedLines.length);

    for (let i = 0; i < maxLen; i++) {
      const orig = originalLines[i];
      const mod = modifiedLines[i];

      if (orig === mod) {
        diffLines.push(`  ${orig}`);
      } else {
        if (orig !== undefined) {
          diffLines.push(`- ${orig}`);
          removed++;
        }
        if (mod !== undefined) {
          diffLines.push(`+ ${mod}`);
          added++;
        }
      }
    }

    return {
      original,
      modified,
      diff: diffLines.join('\n'),
      added,
      removed,
    };
  }

  /**
   * Format diff for display
   */
  static format(result: DiffResult): string {
    const lines = result.diff.split('\n').map(line => {
      if (line.startsWith('+')) return `\x1b[32m${line}\x1b[0m`;
      if (line.startsWith('-')) return `\x1b[31m${line}\x1b[0m`;
      return line;
    });

    return [
      `\x1b[36m--- Changes: -${result.removed} / +${result.added} ---\x1b[0m`,
      ...lines,
      `\x1b[36m--- End ---\x1b[0m`,
    ].join('\n');
  }
}

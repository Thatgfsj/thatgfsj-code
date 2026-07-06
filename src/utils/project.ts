/**
 * Project Context - Detect project type and gather info
 * Migrated from old src/utils/project-context.ts + getProjectContext() from index.ts
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

export interface ProjectInfo {
  type: string;
  name: string;
  path: string;
  fileCount: number;
  dependencies: number;
}

export interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export class ProjectContext {
  /**
   * Get project context string for display
   */
  static getSummary(cwd: string = process.cwd()): string {
    const info: string[] = [];

    try {
      const pkgPath = join(cwd, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        info.push(`📦 Project: ${cwd}`);
        info.push(`   Name: ${pkg.name || 'unknown'}`);
        const depCount = Object.keys(pkg.dependencies || {}).length;
        if (depCount > 0) info.push(`   Deps: ${depCount} packages`);
      } else {
        info.push(`📁 Working dir: ${cwd}`);
      }

      const fileCount = ProjectContext.countCodeFiles(cwd);
      if (fileCount > 0) {
        info.push(`   Files: ${fileCount} code files`);
      }
    } catch {
      info.push(`📁 Working dir: ${cwd}`);
    }

    return info.join('\n');
  }

  /**
   * Count code files in directory (skipping node_modules, .git, etc.)
   */
  static countCodeFiles(dir: string, maxDepth = 3): number {
    let count = 0;
    const codeExts = /\.(ts|js|py|go|rs|java|cpp|c|h|tsx|jsx|vue|svelte)$/;

    const walk = (d: string, depth: number) => {
      if (depth > maxDepth) return;
      try {
        const items = readdirSync(d);
        for (const item of items) {
          if (['node_modules', '.git', 'dist', 'build', '__pycache__'].includes(item)) continue;
          const fullPath = join(d, item);
          try {
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
              walk(fullPath, depth + 1);
            } else if (codeExts.test(item)) {
              count++;
            }
          } catch {
            // Skip inaccessible files
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    walk(dir, 0);
    return count;
  }

  /**
   * Detect project type from files
   */
  static detectType(cwd: string = process.cwd()): string {
    if (existsSync(join(cwd, 'package.json'))) return 'node';
    if (existsSync(join(cwd, 'Cargo.toml'))) return 'rust';
    if (existsSync(join(cwd, 'go.mod'))) return 'go';
    if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'requirements.txt'))) return 'python';
    if (existsSync(join(cwd, 'build.gradle'))) return 'java';
    return 'unknown';
  }
}

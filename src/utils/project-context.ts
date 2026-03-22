/**
 * Project Context - Auto-detect and read project files
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

export interface ProjectInfo {
  root: string;
  name: string;
  language: string;
  buildTool?: string;
  gitIgnore: string[];
  files: string[];
  hasGit: boolean;
  packageJson?: PackageJson;
}

export interface PackageJson {
  name: string;
  version: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export class ProjectContext {
  private root: string;

  constructor(root: string = process.cwd()) {
    this.root = root;
  }

  /**
   * Detect project type and gather context
   */
  async detect(): Promise<ProjectInfo> {
    const info: ProjectInfo = {
      root: this.root,
      name: this.getProjectName(),
      language: this.detectLanguage(),
      buildTool: this.detectBuildTool(),
      gitIgnore: this.readGitIgnore(),
      files: this.listFiles(),
      hasGit: existsSync(join(this.root, '.git'))
    };

    const pkg = this.readPackageJson();
    if (pkg) {
      info.packageJson = pkg;
    }

    return info;
  }

  /**
   * Get project name
   */
  private getProjectName(): string {
    const pkg = this.readPackageJson();
    if (pkg?.name) {
      return pkg.name;
    }
    return this.root.split(/[\\/]/).pop() || 'unknown';
  }

  /**
   * Detect primary language
   */
  private detectLanguage(): string {
    const langCounts: Record<string, number> = {};
    
    const scan = (dir: string, depth: number = 0) => {
      if (depth > 3) return;
      try {
        const items = readdirSync(dir);
        for (const item of items) {
          if (['node_modules', '.git', 'dist'].includes(item)) continue;
          const fullPath = join(dir, item);
          try {
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
              scan(fullPath, depth + 1);
            } else if (stat.isFile()) {
              const ext = item.split('.').pop()?.toLowerCase();
              if (ext) langCounts[ext] = (langCounts[ext] || 0) + 1;
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    };
    
    scan(this.root);
    
    const extToLang: Record<string, string> = {
      'ts': 'TypeScript', 'tsx': 'TypeScript',
      'js': 'JavaScript', 'jsx': 'JavaScript', 'mjs': 'JavaScript',
      'py': 'Python', 'java': 'Java', 'go': 'Go', 'rs': 'Rust',
      'c': 'C/C++', 'cpp': 'C/C++', 'h': 'C/C++', 'hpp': 'C/C++',
      'cs': 'C#', 'rb': 'Ruby', 'php': 'PHP',
    };
    
    for (const [ext, count] of Object.entries(langCounts)) {
      const lang = extToLang[ext];
      if (lang && count > 0) return lang;
    }
    
    return 'Unknown';
  }

  /**
   * Detect build tool
   */
  private detectBuildTool(): string | undefined {
    if (existsSync(join(this.root, 'package.json'))) return 'npm/yarn/pnpm';
    if (existsSync(join(this.root, 'Cargo.toml'))) return 'Cargo';
    if (existsSync(join(this.root, 'go.mod'))) return 'Go';
    if (existsSync(join(this.root, 'pom.xml'))) return 'Maven';
    if (existsSync(join(this.root, 'build.gradle'))) return 'Gradle';
    if (existsSync(join(this.root, 'Makefile'))) return 'Make';
    return undefined;
  }

  /**
   * Read .gitignore
   */
  private readGitIgnore(): string[] {
    const path = join(this.root, '.gitignore');
    if (!existsSync(path)) return [];
    try {
      return readFileSync(path, 'utf-8').split('\n')
        .map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    } catch { return []; }
  }

  /**
   * Read package.json
   */
  private readPackageJson(): PackageJson | null {
    const path = join(this.root, 'package.json');
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch { return null; }
  }

  /**
   * List project files
   */
  private listFiles(maxFiles: number = 100): string[] {
    const files: string[] = [];
    const gitIgnore = this.readGitIgnore();
    
    const scan = (dir: string, depth: number = 0) => {
      if (depth > 4 || files.length >= maxFiles) return;
      try {
        const items = readdirSync(dir);
        for (const item of items) {
          if (files.length >= maxFiles) break;
          if (this.isIgnored(item, gitIgnore)) continue;
          const fullPath = join(dir, item);
          const relPath = relative(this.root, fullPath);
          try {
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
              files.push(relPath + '/');
              scan(fullPath, depth + 1);
            } else if (stat.isFile()) {
              files.push(relPath);
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    };
    
    scan(this.root);
    return files;
  }

  /**
   * Check if ignored
   */
  private isIgnored(name: string, gitIgnore: string[]): boolean {
    const common = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.env'];
    if (common.includes(name)) return true;
    return gitIgnore.includes(name);
  }

  /**
   * Get context summary
   */
  async getContextSummary(): Promise<string> {
    const info = await this.detect();
    const lines = [`📁 Project: ${info.name}`, `💻 Language: ${info.language}`];
    if (info.buildTool) lines.push(`🔧 Build: ${info.buildTool}`);
    if (info.hasGit) lines.push(`📊 Git: Yes`);
    if (info.packageJson) {
      lines.push(`📦 Package: ${info.packageJson.name}@${info.packageJson.version}`);
      if (info.packageJson.scripts) {
        lines.push(`   Scripts: ${Object.keys(info.packageJson.scripts).slice(0, 5).join(', ')}`);
      }
    }
    lines.push(`📁 Files: ${info.files.length} files scanned`);
    return lines.join('\n');
  }
}

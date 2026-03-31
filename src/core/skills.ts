/**
 * S10: Skills System
 * Load skills from CLAUDE.md files and expose them as available commands
 * 
 * Skills are domain-specific knowledge packages that extend agent capabilities.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';

export interface Skill {
  name: string;
  description: string;
  prompt: string;
  source: string; // File path or 'builtin'
  tags: string[];
}

export interface SkillsCatalog {
  skills: Skill[];
  loadedAt: Date;
  sources: string[];
}

/**
 * S10: Skills Loader — discovers and loads skills from filesystem
 */
export class SkillsLoader {
  private skills: Map<string, Skill> = new Map();
  private sources: Set<string> = new Set();

  /**
   * S10: Load skills from a directory
   * Looks for .md files with # SkillName header
   */
  loadFromDir(dirPath: string): number {
    if (!existsSync(dirPath)) return 0;

    let count = 0;
    const files = readdirSync(dirPath);

    for (const file of files) {
      const fullPath = join(dirPath, file);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        count += this.loadFromDir(fullPath);
        continue;
      }

      if (file.endsWith('.md') || file.endsWith('.skill')) {
        const loaded = this.loadFromFile(fullPath);
        if (loaded) count++;
      }
    }

    return count;
  }

  /**
   * S10: Load a single skill file
   */
  loadFromFile(filePath: string): boolean {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const skill = this.parseSkillFile(content, filePath);
      if (skill) {
        this.skills.set(skill.name, skill);
        this.sources.add(filePath);
        return true;
      }
    } catch (error) {
      // Ignore errors
    }
    return false;
  }

  /**
   * S10: Parse a skill file — extract name, description, prompt from markdown
   */
  private parseSkillFile(content: string, source: string): Skill | null {
    const lines = content.split('\n');

    // Find skill name from first heading
    let name = '';
    let description = '';
    let promptLines: string[] = [];
    let inPrompt = false;
    let tags: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match # SkillName or ## SkillName
      if (/^#{1,2}\s+(\S+)/.test(line.trim())) {
        if (!name) {
          name = line.replace(/^#{1,2}\s+/, '').trim();
        } else {
          // Second heading — end of prompt
          break;
        }
        continue;
      }

      // Description line (after name, before first code block or empty line)
      if (name && !description && line.trim() && !line.startsWith('```')) {
        description = line.trim();
      }

      // Code block — start of prompt template
      if (line.startsWith('```')) {
        if (!inPrompt) {
          inPrompt = true;
          continue;
        } else {
          // End of prompt
          break;
        }
      }

      if (inPrompt) {
        promptLines.push(line);
      }
    }

    if (!name) return null;

    return {
      name,
      description: description || name,
      prompt: promptLines.join('\n').trim(),
      source,
      tags: this.extractTags(content)
    };
  }

  private extractTags(content: string): string[] {
    const tagMatch = content.match(/tags?:\s*(.+)/i);
    if (tagMatch) {
      return tagMatch[1].split(/[,\s]+/).filter(Boolean);
    }
    return [];
  }

  /**
   * S10: Get all skills
   */
  getAll(): Skill[] {
    return [...this.skills.values()];
  }

  /**
   * S10: Get skill by name
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * S10: Search skills by tag or name
   */
  search(query: string): Skill[] {
    const q = query.toLowerCase();
    return this.getAll().filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  /**
   * S10: Get catalog
   */
  getCatalog(): SkillsCatalog {
    return {
      skills: this.getAll(),
      loadedAt: new Date(),
      sources: [...this.sources]
    };
  }
}

/**
 * S10: Built-in skills
 */
export const BUILT_IN_SKILLS: Skill[] = [
  {
    name: 'explain-code',
    description: 'Explain what a piece of code does in plain English',
    prompt: 'Explain this code:\n\n```\n{{CODE}}\n```\n\nBe concise and clear.',
    source: 'builtin',
    tags: ['analysis', 'documentation']
  },
  {
    name: 'review-code',
    description: 'Review code for bugs, performance issues, and best practices',
    prompt: 'Review this code:\n\n```\n{{CODE}}\n```\n\nFocus on: bugs, security, performance, readability.',
    source: 'builtin',
    tags: ['review', 'quality']
  },
  {
    name: 'write-test',
    description: 'Generate unit tests for the given code',
    prompt: 'Write unit tests for:\n\n```\n{{CODE}}\n```\n\nUse a testing framework appropriate for the language.',
    source: 'builtin',
    tags: ['testing', 'quality']
  }
];

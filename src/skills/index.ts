/**
 * Skills Registry - Built-in skills for development workflows
 * Inspired by skills.sh (obra/superpowers, mattpocock/skills, anthropics/skills)
 */

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: 'planning' | 'debugging' | 'testing' | 'architecture' | 'workflow' | 'browser' | 'review';
  prompt: string;
  autoActivate?: string[]; // Keywords that auto-activate this skill
}

// Import all skills
import { writingPlansSkill } from './writing-plans.js';
import { executingPlansSkill } from './executing-plans.js';
import { systematicDebuggingSkill } from './systematic-debugging.js';
import { brainstormingSkill } from './brainstorming.js';
import { tddSkill } from './tdd.js';
import { improveArchitectureSkill } from './improve-architecture.js';
import { verificationSkill } from './verification.js';
import { codeReviewSkill } from './code-review.js';
import { prototypeSkill } from './prototype.js';
import { triageSkill } from './triage.js';
import { gitWorkflowSkill } from './git-workflow.js';
import { subagentSkill } from './subagent.js';
import { playwrightSkill } from './playwright.js';
import { frontendDesignSkill } from './frontend-design.js';
import { supabaseSkill } from './supabase.js';
import { neuroweaveSkill } from './neuroweave.js';

// All built-in skills (16 total)
export const BUILTIN_SKILLS: Skill[] = [
  writingPlansSkill,
  executingPlansSkill,
  systematicDebuggingSkill,
  brainstormingSkill,
  tddSkill,
  improveArchitectureSkill,
  verificationSkill,
  codeReviewSkill,
  prototypeSkill,
  triageSkill,
  gitWorkflowSkill,
  subagentSkill,
  playwrightSkill,
  frontendDesignSkill,
  supabaseSkill,
  neuroweaveSkill,
];

// Skill registry
export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private activeSkills: Set<string> = new Set();

  constructor() {
    for (const skill of BUILTIN_SKILLS) {
      this.skills.set(skill.id, skill);
    }
    // Default active skills
    this.activeSkills.add('writing-plans');
    this.activeSkills.add('systematic-debugging');
    this.activeSkills.add('verification');
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  listActive(): Skill[] {
    return [...this.activeSkills].map(id => this.skills.get(id)!).filter(Boolean);
  }

  activate(id: string): boolean {
    if (this.skills.has(id)) {
      this.activeSkills.add(id);
      return true;
    }
    return false;
  }

  deactivate(id: string): boolean {
    return this.activeSkills.delete(id);
  }

  isActive(id: string): boolean {
    return this.activeSkills.has(id);
  }

  /**
   * Get all active skill prompts for system prompt injection
   */
  getActivePrompts(): string {
    const active = this.listActive();
    if (active.length === 0) return '';

    return active.map(s => `### Skill: ${s.name}\n${s.prompt}`).join('\n\n');
  }

  /**
   * Auto-activate skills based on user input
   */
  autoActivate(input: string): void {
    const lower = input.toLowerCase();
    for (const skill of this.skills.values()) {
      if (skill.autoActivate?.some(kw => lower.includes(kw))) {
        this.activeSkills.add(skill.id);
      }
    }
  }
}

export {
  writingPlansSkill,
  executingPlansSkill,
  systematicDebuggingSkill,
  brainstormingSkill,
  tddSkill,
  improveArchitectureSkill,
  verificationSkill,
  codeReviewSkill,
  prototypeSkill,
  triageSkill,
  gitWorkflowSkill,
  subagentSkill,
  playwrightSkill,
  frontendDesignSkill,
  supabaseSkill,
  neuroweaveSkill,
};

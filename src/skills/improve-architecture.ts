import type { Skill } from './index.js';

export const improveArchitectureSkill: Skill = {
  id: 'improve-architecture',
  name: 'Improve Architecture',
  description: 'Systematically improve codebase structure and quality',
  category: 'architecture',
  autoActivate: ['重构', 'refactor', '架构', 'architecture', 'clean', 'improve'],
  prompt: `## Architecture Improvement Protocol

When improving code structure:

### 1. Assess Current State
- Read the code and identify pain points
- Look for: god classes, circular dependencies, tight coupling, code duplication

### 2. Identify Patterns
- **Single Responsibility**: Does each module/class do ONE thing?
- **Dependency Direction**: Do high-level modules depend on low-level ones?
- **Abstraction Level**: Is each layer at the right abstraction?

### 3. Plan Changes
- Start with the highest-impact, lowest-risk change
- Each change should be independently valuable
- Never refactor everything at once

### 4. Execute Safely
- Make one change at a time
- Verify after each change
- Commit frequently

### Red Flags to Fix
- Files over 300 lines
- Functions over 50 lines
- More than 3 levels of nesting
- Copy-pasted code blocks
- Circular imports`,
};

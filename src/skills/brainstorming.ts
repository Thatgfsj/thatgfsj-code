import type { Skill } from './index.js';

export const brainstormingSkill: Skill = {
  id: 'brainstorming',
  name: 'Brainstorming',
  description: 'Explore multiple approaches before committing to a solution',
  category: 'planning',
  autoActivate: ['怎么', 'how to', '方案', 'approach', '有没有', 'alternatives'],
  prompt: `## Brainstorming Mode

When exploring solutions, don't jump to the first idea. Instead:

### 1. Generate Options
List 3-5 different approaches, including at least one unconventional one.

### 2. Evaluate Each
For each approach, briefly note:
- **Pros**: What makes it good
- **Cons**: What could go wrong
- **Effort**: How much work (quick/medium/heavy)

### 3. Recommend
Pick the best approach and explain WHY it's the best fit for this specific situation.

### Format
\`\`\`
## Approaches

### Option A: [Name]
- Pros: ...
- Cons: ...
- Effort: medium

### Option B: [Name]
- Pros: ...
- Cons: ...
- Effort: quick

**Recommendation**: Option B because [specific reason]
\`\`\`

Don't just list options - give a clear recommendation with reasoning.`,
};

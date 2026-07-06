import type { Skill } from './index.js';

export const neuroweaveSkill: Skill = {
  id: 'neuroweave',
  name: 'NeuroWeave Timeline',
  description: 'Project evolution memory - track decisions, changes, and milestones',
  category: 'workflow',
  autoActivate: ['timeline', 'history', 'what changed', 'why was', 'track'],
  prompt: `## NeuroWeave Timeline (NWT)

You have access to the NWT tool for tracking project evolution. Use it to:

### When to Log Events
- **After significant changes**: New features, refactors, bug fixes
- **When making decisions**: Architecture choices, library selection, design patterns
- **At milestones**: Feature complete, tests passing, deployment ready

### How to Log
\`\`\`
nwt log
  task: "Add user authentication"
  summary: "Implemented JWT-based auth with login/register endpoints"
  reason: "Need user accounts for personalized features"
  files: "src/auth.ts, src/routes/auth.ts"
  tags: "feature, auth, api"
\`\`\`

### Tags Convention
- \`feature\` - New functionality
- \`fix\` - Bug fixes
- \`refactor\` - Code restructuring
- \`decision\` - Architecture/design decisions
- \`milestone\` - Project milestones
- \`config\` - Configuration changes
- \`docs\` - Documentation updates

### Auto-log Rule
After completing a multi-step task, automatically log it to NWT with:
- task: What was done (imperative)
- summary: How it was done
- reason: Why it was done
- files: What files changed
- tags: Category labels

### Archives
Events older than 30 days are automatically archived. Use \`nwt story\` to see the full project narrative.`,
};

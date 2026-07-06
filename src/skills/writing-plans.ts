import type { Skill } from './index.js';

export const writingPlansSkill: Skill = {
  id: 'writing-plans',
  name: 'Writing Plans',
  description: 'Break down complex tasks into step-by-step execution plans',
  category: 'planning',
  autoActivate: ['plan', '怎么实现', '如何做', '方案', '设计', '架构'],
  prompt: `## Planning Mode

When the user asks you to plan something or the task is complex:

1. **Understand the goal** - Clarify what the user wants to achieve
2. **Explore the codebase** - Read relevant files to understand context
3. **Break it down** - Create a numbered list of concrete steps
4. **Identify risks** - Note potential issues or blockers
5. **Estimate complexity** - Mark steps as simple/medium/complex

### Plan Format
\`\`\`
## Plan: [Task Description]

### Context
- What we know about the current state
- Files/modules involved

### Steps
1. [Step description] (simple/medium/complex)
2. [Step description]
   - Sub-step if needed
3. [Step description]

### Risks
- [Potential issue and mitigation]

### Files to modify
- path/to/file1.ts - [what changes]
- path/to/file2.ts - [what changes]
\`\`\`

Always present the plan to the user before executing. Ask: "Should I proceed with this plan?"`,
};

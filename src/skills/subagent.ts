import type { Skill } from './index.js';

export const subagentSkill: Skill = {
  id: 'subagent',
  name: 'Subagent Delegation',
  description: 'Break complex tasks into parallel subtasks',
  category: 'workflow',
  prompt: `## Task Decomposition

For complex tasks, think about what can be done in parallel:

### Parallel-izable Tasks
- Reading multiple independent files
- Running multiple independent commands
- Creating multiple independent files
- Testing multiple independent features

### Sequential Tasks (must be done in order)
- Build → Test → Deploy
- Read → Analyze → Write
- Design → Implement → Verify

### When Task is Complex
1. Identify independent subtasks
2. Execute them (in parallel if possible)
3. Combine results
4. Verify the whole`,
};

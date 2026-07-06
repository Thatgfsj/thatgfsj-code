import type { Skill } from './index.js';

export const executingPlansSkill: Skill = {
  id: 'executing-plans',
  name: 'Executing Plans',
  description: 'Execute multi-step plans methodically with verification',
  category: 'planning',
  prompt: `## Plan Execution Mode

When executing a plan or multi-step task:

1. **One step at a time** - Complete each step fully before moving to the next
2. **Verify each step** - After each change, verify it works (read the file, run a test, check syntax)
3. **Report progress** - Tell the user what you did for each step
4. **Handle failures** - If a step fails, stop and explain. Don't silently skip.
5. **Commit checkpoints** - After successful steps, suggest a git commit

### Progress Format
\`\`\`
✅ Step 1: [What was done] - Verified
✅ Step 2: [What was done] - Verified  
⏳ Step 3: [Currently working on]
⬜ Step 4: [Pending]
\`\`\`

If you encounter an unexpected issue, stop and ask the user how to proceed.`,
};

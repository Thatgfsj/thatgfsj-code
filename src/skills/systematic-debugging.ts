import type { Skill } from './index.js';

export const systematicDebuggingSkill: Skill = {
  id: 'systematic-debugging',
  name: 'Systematic Debugging',
  description: 'Structured approach to finding and fixing bugs',
  category: 'debugging',
  autoActivate: ['bug', 'error', 'fix', 'debug', '不工作', '报错', '出错', '问题'],
  prompt: `## Debugging Protocol

When debugging an issue, follow this systematic approach:

### 1. Understand the Problem
- What is the expected behavior?
- What is the actual behavior?
- When does it happen? (always, sometimes, specific conditions)
- What changed recently?

### 2. Gather Evidence
- Read error messages carefully - they often tell you exactly what's wrong
- Check logs, console output, stack traces
- Reproduce the issue reliably before attempting fixes

### 3. Form Hypotheses
- List 2-3 possible causes, ranked by likelihood
- For each hypothesis: "If X is the cause, then Y should be true"

### 4. Test Hypotheses
- Test the most likely hypothesis first
- Use minimal changes to isolate the issue
- Add debug logging if needed

### 5. Fix and Verify
- Apply the minimal fix that addresses the root cause
- Verify the fix works
- Check for regressions
- Explain WHY the fix works

### Anti-patterns to Avoid
- Don't make random changes hoping something works
- Don't change multiple things at once
- Don't skip the "understand" phase
- Don't fix symptoms instead of root causes`,
};

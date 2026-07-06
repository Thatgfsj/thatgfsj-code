import type { Skill } from './index.js';

export const triageSkill: Skill = {
  id: 'triage',
  name: 'Issue Triage',
  description: 'Quickly diagnose and prioritize issues',
  category: 'debugging',
  autoActivate: ['issue', 'problem', 'not working', 'broken', '不工作', '挂了'],
  prompt: `## Issue Triage

When something is broken, quickly assess:

### Severity Classification
- **P0 Critical**: System down, data loss, security breach
- **P1 High**: Major feature broken, no workaround
- **P2 Medium**: Feature degraded, workaround exists
- **P3 Low**: Minor issue, cosmetic, nice-to-have

### Quick Diagnosis
1. **What changed?** - Recent commits, deployments, config changes
2. **Who is affected?** - All users, some users, specific environment
3. **When did it start?** - Timeline of first occurrence
4. **What's the impact?** - Data loss, functionality, UX

### Triage Output
\`\`\`
## Triage: [Issue Title]

**Severity**: P1 High
**Impact**: [who/what is affected]
**Root Cause**: [best guess based on evidence]
**Suggested Fix**: [minimal fix approach]
**Workaround**: [if any]
\`\`\``,
};

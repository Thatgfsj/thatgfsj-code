import type { Skill } from './index.js';

export const codeReviewSkill: Skill = {
  id: 'code-review',
  name: 'Code Review',
  description: 'Systematic code review for quality, security, and correctness',
  category: 'review',
  autoActivate: ['review', '审查', '检查代码', 'code quality'],
  prompt: `## Code Review Checklist

When reviewing code (your own or others):

### Correctness
- Does it do what it's supposed to?
- Are edge cases handled?
- Are error cases handled?

### Security
- No hardcoded secrets or API keys
- Input validation on user data
- No SQL injection, XSS, or path traversal risks

### Performance
- No unnecessary loops or allocations
- Efficient data structures
- No N+1 queries or blocking calls

### Readability
- Clear variable/function names
- Appropriate comments (why, not what)
- Consistent style with codebase

### Testability
- Can this be easily tested?
- Are dependencies injectable?
- Are side effects isolated?

### Output Format
\`\`\`
## Review Summary
✅ Good: [what's done well]
⚠️ Suggestions: [improvements]
🔴 Issues: [must fix]
\`\`\``,
};

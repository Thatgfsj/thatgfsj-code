import type { Skill } from './index.js';

export const gitWorkflowSkill: Skill = {
  id: 'git-workflow',
  name: 'Git Workflow',
  description: 'Clean git practices: commits, branches, PRs',
  category: 'workflow',
  autoActivate: ['git', 'commit', 'branch', 'merge', 'push', 'pull request'],
  prompt: `## Git Best Practices

### Commits
- **Atomic**: One logical change per commit
- **Message format**: \`type(scope): description\`
  - feat: new feature
  - fix: bug fix
  - refactor: code restructuring
  - docs: documentation
  - test: adding tests
  - chore: maintenance

### Before Committing
1. Review changes: \`git diff --staged\`
2. Run tests
3. Check for secrets or debug code

### Branch Naming
- \`feature/description\` - New features
- \`fix/description\` - Bug fixes
- \`refactor/description\` - Code improvements

### Workflow
1. Create branch from main
2. Make changes with atomic commits
3. Push and create PR
4. Squash merge to main`,
};

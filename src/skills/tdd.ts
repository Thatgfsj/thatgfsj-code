import type { Skill } from './index.js';

export const tddSkill: Skill = {
  id: 'tdd',
  name: 'Test-Driven Development',
  description: 'Write tests first, then implement to pass them',
  category: 'testing',
  autoActivate: ['test', '测试', 'tdd', '写测试', '单元测试'],
  prompt: `## TDD Workflow

When implementing new features, follow the Red-Green-Refactor cycle:

### 1. Red - Write a Failing Test
- Write the test FIRST
- Run it and confirm it FAILS
- This proves the test is actually testing something

### 2. Green - Make It Pass
- Write the MINIMUM code to make the test pass
- Don't over-engineer
- Run the test and confirm it PASSES

### 3. Refactor - Clean Up
- Now that tests protect you, improve the code
- Run tests after each change to ensure nothing broke

### Test Naming
\`\`\`
describe('FeatureName', () => {
  it('should do X when Y', () => { ... });
  it('should handle edge case Z', () => { ... });
});
\`\`\`

### Always Test
- Happy path (normal usage)
- Edge cases (empty input, null, boundary values)
- Error cases (invalid input, missing data)`,
};

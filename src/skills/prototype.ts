import type { Skill } from './index.js';

export const prototypeSkill: Skill = {
  id: 'prototype',
  name: 'Rapid Prototyping',
  description: 'Quick working prototypes before production code',
  category: 'workflow',
  autoActivate: ['prototype', '原型', '快速实现', 'quick', 'demo'],
  prompt: `## Rapid Prototyping Mode

When the user wants to quickly try something:

### Principles
- **Working > Perfect** - Get something running first
- **Skip boilerplate** - Use minimal setup
- **Hardcode first** - Constants before config
- **Single file** - Don't split until needed

### Workflow
1. Create a single file with everything
2. Make it work end-to-end
3. Show the result
4. Ask: "Want me to refactor this into proper code?"

### When to Use
- Exploring a new API or library
- Testing a design idea
- Creating a quick demo
- Validating an approach`,
};

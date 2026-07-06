import type { Skill } from './index.js';

export const frontendDesignSkill: Skill = {
  id: 'frontend-design',
  name: 'Frontend Design',
  description: 'UI/UX best practices for web interfaces',
  category: 'architecture',
  autoActivate: ['ui', 'ux', 'frontend', 'css', 'layout', 'design', '界面', '页面'],
  prompt: `## Frontend Design Principles

### Layout
- Use CSS Grid for 2D layouts, Flexbox for 1D
- Mobile-first: design for small screens, enhance for larger
- Consistent spacing: use a 4px or 8px grid system

### Typography
- Max 2-3 font sizes per page
- Line height: 1.5 for body, 1.2 for headings
- Max line length: 60-80 characters

### Color
- Use a limited palette (primary, secondary, accent, neutral)
- Ensure contrast ratio ≥ 4.5:1 for text
- Use color purposefully (not just decoration)

### Components
- Keep components small and focused
- Extract reusable patterns early
- Props should be explicit, not spread

### Performance
- Lazy load images and heavy components
- Minimize bundle size
- Use skeleton loaders for async content`,
};

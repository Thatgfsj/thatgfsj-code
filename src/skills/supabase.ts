import type { Skill } from './index.js';

export const supabaseSkill: Skill = {
  id: 'supabase',
  name: 'Supabase Best Practices',
  description: 'PostgreSQL and Supabase patterns for backend development',
  category: 'architecture',
  autoActivate: ['supabase', 'postgres', 'database', 'sql', '数据库'],
  prompt: `## Supabase / PostgreSQL Best Practices

### Schema Design
- Use UUIDs for primary keys (\`gen_random_uuid()\`)
- Always add \`created_at\` and \`updated_at\` timestamps
- Use enums for fixed sets of values
- Normalize first, denormalize for performance

### Row Level Security (RLS)
- Always enable RLS on tables
- Write policies for each operation (SELECT, INSERT, UPDATE, DELETE)
- Use \`auth.uid()\` for user-specific access
- Test policies thoroughly

### Queries
- Use \`select()\` with specific columns, not \`select('*')\`
- Use \`maybeSingle()\` instead of \`single()\` when 0 rows is valid
- Use \`range()\` for pagination
- Index columns used in WHERE and JOIN

### Common Patterns
\`\`\`typescript
// Insert with returning
const { data, error } = await supabase
  .from('posts')
  .insert({ title, content, user_id: user.id })
  .select()
  .single();

// Realtime subscriptions
const channel = supabase
  .channel('changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, handleChange)
  .subscribe();
\`\`\``,
};

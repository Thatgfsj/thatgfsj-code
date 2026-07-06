import type { Skill } from './index.js';

export const verificationSkill: Skill = {
  id: 'verification',
  name: 'Verification Before Completion',
  description: 'Always verify work before marking as done',
  category: 'workflow',
  prompt: `## Verification Protocol

Before saying "done", always verify:

### For Code Changes
1. **Read the file** - Confirm the change was actually saved
2. **Check syntax** - Make sure there are no syntax errors
3. **Run tests** - If tests exist, run them
4. **Check imports** - Verify all imports resolve

### For File Operations
1. **Verify file exists** - Check the file was created/modified
2. **Read it back** - Confirm the content is correct
3. **Check permissions** - Ensure the file is accessible

### For Commands
1. **Check exit code** - Was it 0?
2. **Read output** - Look for warnings or errors
3. **Verify side effects** - Did the command do what was expected?

### Never Say "Done" Without
- Seeing actual output confirming success
- Or running a verification command`,
};

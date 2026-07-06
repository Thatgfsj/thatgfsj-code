// Simulates the exact useChat stream-parsing logic from src/tui/hooks/useChat.ts
// to confirm tool result is correctly extracted from streaming chunks.

function simulateUseChat(chunks) {
  let fullContent = '';
  let currentToolCalls = [];
  const states = [];

  for (const chunk of chunks) {
    if (chunk.includes('@@TOOL@@')) {
      const parts = chunk.split('\n');
      for (const part of parts) {
        if (part.startsWith('@@TOOL@@')) {
          try {
            const data = JSON.parse(part.slice(8));
            if (data.action === 'call') {
              currentToolCalls.push({ name: data.name, args: data.args || '' });
              states.push({ kind: 'call', toolCalls: JSON.parse(JSON.stringify(currentToolCalls)) });
            } else if (data.action === 'result') {
              const lastIdx = currentToolCalls.length - 1;
              if (lastIdx >= 0) {
                currentToolCalls[lastIdx] = {
                  ...currentToolCalls[lastIdx],
                  result: data.output || data.error || '',
                  isError: !!data.error,
                };
              }
              states.push({ kind: 'result', toolCalls: JSON.parse(JSON.stringify(currentToolCalls)) });
            }
          } catch (e) {
            fullContent += part;
          }
        } else if (part) {
          fullContent += part;
        }
      }
    } else {
      fullContent += chunk;
    }
  }

  return { fullContent, states, finalToolCalls: currentToolCalls };
}

// Simulate what LLMService.chatStream yields in a real session:
//   iter 1: tool_call → tool.execute → tool_result → \n → loop
//   iter 2: text "好嘞，那我给你演示..."
const chunks = [
  '\n@@TOOL@@{"action":"call","name":"shell","args":"{\\"command\\":\\"date\\"}"}\n',
  '@@TOOL@@{"action":"result","output":"Mon Jul 6 22:00:00 CST 2026"}\n',
  '\n',
  '\n',
  '好',
  '嘞',
  '，',
  '那我',
  '给你',
  '演示一组工具——并行调用，互不干扰：',
  '\n',
];

const result = simulateUseChat(chunks);
console.log('--- states (push order) ---');
result.states.forEach((s, i) => console.log(i, s.kind, JSON.stringify(s.toolCalls)));
console.log('--- final ---');
console.log('fullContent:', JSON.stringify(result.fullContent));
console.log('finalToolCalls:', JSON.stringify(result.finalToolCalls));
console.log('--- last tool call has result? ---');
console.log(!!result.finalToolCalls[0]?.result, '=>', result.finalToolCalls[0]?.result);
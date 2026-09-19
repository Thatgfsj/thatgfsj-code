/** @jsxImportSource react */
import React, { useMemo } from 'react';
import { Text } from 'ink';
import { Marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

/**
 * v3.2.1 width fix: marked-terminal silently defaults to width 80, so on
 * wide terminals the assistant's answer wrapped into a narrow ~80-col
 * column (user report: "回答只有右侧一点点区域"). We now render each block
 * with an explicit renderer width — the WORKSPACE width handed down from
 * ChatList/ChatMessage — instead of the library default.
 */
const marked = new Marked();

interface Props {
  content: string;
  /** Available workspace width for wrapping (defaults to 80). */
  width?: number;
}

export function Markdown({ content, width }: Props) {
  const rendered = useMemo(() => {
    try {
      marked.use({
        // marked-terminal's class doesn't satisfy marked's RendererObject
        // interface structurally (older typing); runtime is compatible.
        renderer: new TerminalRenderer({
          showSectionPrefix: false,
          tab: 2,
          width: Math.max(20, (width ?? 80) - 2),
        }) as any,
      });
      const result = marked.parse(content);
      if (typeof result === 'string') {
        return result.trimEnd();
      }
      return content;
    } catch {
      return content;
    }
  }, [content, width]);

  return <Text>{rendered}</Text>;
}

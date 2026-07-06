/** @jsxImportSource react */
import React, { useMemo } from 'react';
import { Text } from 'ink';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

// Configure marked to use terminal renderer
marked.setOptions({
  // @ts-ignore - marked-terminal types are incomplete
  renderer: new TerminalRenderer({
    showSectionPrefix: false,
    tab: 2,
  }),
});

interface Props {
  content: string;
}

export function Markdown({ content }: Props) {
  const rendered = useMemo(() => {
    try {
      const result = marked.parse(content);
      // marked.parse returns string | Promise<string> depending on async option
      if (typeof result === 'string') {
        return result.trimEnd();
      }
      return content;
    } catch {
      return content;
    }
  }, [content]);

  return <Text>{rendered}</Text>;
}

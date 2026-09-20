/** @jsxImportSource react */
import React, { useMemo } from 'react';
import { Text } from 'ink';
import { Marked, Renderer } from 'marked';
import TerminalRenderer from 'marked-terminal';

/**
 * v3.2.1 width fix: marked-terminal silently defaults to width 80, so on
 * wide terminals the assistant's answer wrapped into a narrow ~80-col
 * column (user report: "回答只有右侧一点点区域"). We render each block
 * with an explicit renderer width — the WORKSPACE width handed down from
 * the app — instead of the library default.
 *
 * v3.2.2 (adversarial-audit fix): `marked.use({ renderer: instance })`
 * THROWS on marked ≥5 ("renderer 'o' does not exist") — it validates every
 * enumerable key of the renderer object against its own Renderer, and the
 * terminal renderer's internal fields (`o`, `tab`, …) fail that check. The
 * old catch silently fell back to raw text: markdown was NEVER actually
 * rendered. And passing the instance to `new Marked(...)` silently renders
 * plain HTML. The working bridge is a shim: expose only the method names
 * marked knows; each shim syncs marked's injected `parser`/`options` (they
 * arrive on marked's own renderer instance via `this`) onto the terminal
 * renderer and delegates. reflowText makes paragraphs wrap at the width.
 */
function makeTerminalRendererPack(width: number): Record<string, (...args: any[]) => any> {
  const inst: any = new TerminalRenderer({ width, reflowText: true });
  const pack: Record<string, (...args: any[]) => any> = {};
  for (let proto = Object.getPrototypeOf(inst); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const k of Object.getOwnPropertyNames(proto)) {
      if (k === 'constructor' || typeof inst[k] !== 'function') continue;
      if (!(k in Renderer.prototype)) continue; // only methods marked validates
      if (pack[k]) continue;
      pack[k] = function (this: any, ...args: any[]) {
        inst.parser = this?.parser ?? inst.parser;
        inst.options = this?.options ?? inst.options;
        return inst[k].apply(inst, args);
      };
    }
  }
  return pack;
}

interface Props {
  content: string;
  /** Available workspace width for wrapping (defaults to 80). */
  width?: number;
}

export function Markdown({ content, width }: Props) {
  const rendered = useMemo(() => {
    try {
      const marked = new Marked();
      marked.use({
        // v3.4.10: single newlines must survive. CommonMark folds them into
        // spaces, which flattened every command output (/help became one
        // paragraph — user report). Terminal readers expect literal lines.
        breaks: true,
        renderer: makeTerminalRendererPack(Math.max(20, (width ?? 80) - 2)) as any,
      });
      const result = marked.parse(content, { async: false });
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

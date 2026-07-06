/**
 * Thinking block extraction + compression
 *
 * Models that aren't truly reasoning-capable (Qwen, DeepSeek-V3 chat,
 * Kimi, etc.) still emit `<think>...</think>` blocks as plain text
 * inside their response. These blocks can be hundreds of lines of
 * internal monologue that the user doesn't want to see scroll by.
 *
 * opencode handles this by separating reasoning into its own stream
 * part at the protocol level. We don't have that luxury — the model
 * is emitting everything as a single `content` field. So we use the
 * same regex-strip approach opencode uses internally (see
 * packages/opencode/src/session/prompt.ts line 244).
 *
 * Three block delimiters are supported:
 *   1. <think>...</think>          — DeepSeek / Qwen / Kimi
 *   2. <reasoning>...</reasoning>  — OpenRouter-style
 *   3. [THINK]...[/THINK]          — some custom fine-tunes
 *
 * Usage:
 *   const { thinking, conclusion } = splitThinking(fullContent);
 *   if (thinking && compress) {
 *     render(`💭 ${summarize(thinking)}\n${conclusion}`);
 *   } else {
 *     render(fullContent);
 *   }
 */

export interface ThinkingSplit {
  /** Raw `<think>...` content, or empty if none. */
  thinking: string;
  /** Content with thinking blocks stripped + trimmed. */
  conclusion: string;
  /** How many lines the thinking block spanned. */
  thinkingLines: number;
  /** First non-empty line of the thinking block (heuristic summary). */
  thinkingHint: string;
}

/**
 * All known thinking-block delimiters, in priority order. The regex
 * flags `gi` (global, case-insensitive) so `[THINK]` and `<think>`
 * are both caught, and so multiple blocks collapse cleanly.
 */
const THINKING_PATTERNS: RegExp[] = [
  /<think>[\s\S]*?<\/think>/gi,
  /<reasoning>[\s\S]*?<\/reasoning>/gi,
  /\[THINK\][\s\S]*?\[\/THINK\]/gi,
];

export function splitThinking(content: string): ThinkingSplit {
  if (!content) {
    return { thinking: '', conclusion: '', thinkingLines: 0, thinkingHint: '' };
  }

  let thinking = '';
  let remaining = content;

  for (const pat of THINKING_PATTERNS) {
    const matches = remaining.match(pat);
    if (matches) {
      thinking += matches.join('\n');
      remaining = remaining.replace(pat, '');
    }
  }

  const conclusion = remaining.trim();
  const thinkingLines = thinking ? thinking.split('\n').length : 0;
  const thinkingHint = firstNonEmptyLine(thinking);

  return { thinking, conclusion, thinkingLines, thinkingHint };
}

/**
 * Build a short, single-line summary of a thinking block, suitable
 * for collapsed display. Returns something like:
 *   "💭 thought for 24 lines: The user is asking about Win+E..."
 * Falls back to "(no hint)" if the block is empty.
 */
export function summarizeThinking(split: ThinkingSplit): string {
  if (!split.thinking) return '';
  const hint = split.thinkingHint.length > 60
    ? split.thinkingHint.slice(0, 57) + '...'
    : split.thinkingHint;
  return `💭 thought for ${split.thinkingLines} line${split.thinkingLines === 1 ? '' : 's'}${hint ? `: ${hint}` : ''}`;
}

/**
 * Render full content with thinking blocks compressed (collapsed to
 * a single-line indicator). If `showThinking` is true, returns the
 * content unchanged (debug mode).
 */
export function compressThinking(content: string, showThinking: boolean = false): string {
  if (showThinking || !content) return content;
  const split = splitThinking(content);
  if (!split.thinking) return content;
  const summary = summarizeThinking(split);
  return summary ? `${summary}\n${split.conclusion}` : split.conclusion;
}

function firstNonEmptyLine(s: string): string {
  if (!s) return '';
  for (const line of s.split('\n')) {
    // Strip any leading/trailing thinking-tag fragments that may have
    // been captured by the regex (e.g. "<think>The user said..."
    // or "...</think>"). We strip ALL occurrences to handle the
    // case where the first line wraps across a tag.
    const t = line
      .trim()
      .replace(/<\/?think>/gi, '')
      .replace(/<\/?reasoning>/gi, '')
      .replace(/\[\/?THINK\]/gi, '')
      .trim();
    if (t) return t;
  }
  return '';
}

export { THINKING_PATTERNS };
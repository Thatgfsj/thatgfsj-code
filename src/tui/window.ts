/**
 * v3.2.2 viewport window (alt-screen rendering).
 *
 * The alt buffer has NO scrollback, so the conversation must be a WINDOW
 * rendered inside the fixed-height frame: walk backwards from the visible
 * end, accumulate messages while their ESTIMATED line heights fit the
 * workspace rows. Ink's overflow="hidden" drops arbitrary lines (verified
 * empirically), so the budget — never the renderer — decides what is
 * visible. Estimates are deliberately generous (+1 per markdown body) and
 * the budget keeps a slack: an overflow would push the frame taller than
 * the viewport and Ink would full-clear (发屏黑屏), the exact bug this
 * module exists to prevent.
 */
import type { MessageData } from './components/ChatMessage.js';

/** Display width of a string: CJK/fullwidth chars count as 2 cells. */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    // CJK unified, extensions, fullwidth forms, hangul, kana, CJK punct.
    w += (c >= 0x1100 && (
      c <= 0x115f ||                    // hangul jamo
      c === 0x2329 || c === 0x232a ||
      (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) ||
      (c >= 0xac00 && c <= 0xd7a3) ||   // hangul syllables
      (c >= 0xf900 && c <= 0xfaff) ||   // CJK compat ideographs
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||   // fullwidth forms
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff) || // emoji (pictographs, symbols)
      (c >= 0x20000 && c <= 0x3fffd)
    )) ? 2 : 1;
  }
  return w;
}

/** Number of terminal lines `text` needs when wrapped to `width` columns. */
export function wrappedLines(text: string, width: number): number {
  const w = Math.max(8, width);
  let n = 0;
  for (const line of text.split('\n')) {
    n += Math.max(1, Math.ceil(textWidth(line) / w));
  }
  return n;
}

/**
 * Estimated rendered height of one message, workspace `width` columns.
 * Deliberately overestimates markdown (label + blank spacing) — never
 * under, or the frame overflows the viewport.
 */
export function estimateMsgLines(m: MessageData, width: number): number {
  if (m.plain) return wrappedLines(m.content, width);
  if (m.role === 'user') return wrappedLines(m.content, Math.max(8, width - 4)) + 2; // accent bar box + margin
  // assistant: ⎿ tool lines (pending + result), ▪ label, markdown body, margin
  const toolLines = (m.toolCalls?.length ?? 0) * 2;
  const body = m.content ? wrappedLines(m.content, Math.max(8, width - 2)) + 2 : 0;
  return toolLines + body + 1;
}

export interface WindowResult {
  /** The visible slice, oldest → newest. */
  messages: MessageData[];
  /** Index of the first visible message in the source list. */
  start: number;
  /** Index one past the last visible message in the source list. */
  end: number;
}

/**
 * v3.3.0: trim `content` to its TAIL so it renders within `rows` wrapped
 * lines (for the live streaming block). Wrap-aware like buildWindow; the
 * head is replaced by an ellipsis marker.
 */
export function clipContentToRows(content: string, width: number, rows: number): string {
  // v3.5.4 (probe round 7): the EFFECTIVE budget callers pass is
  // rows - 9 on the reference layout (input stack measured at 7 rows,
  // frame spare 2) — documented here because the sandbox probes first
  // assumed rows - 8.
  const budget = Math.max(1, rows);
  if (wrappedLines(content, width) <= budget) return content;
  const lines = content.split('\n');
  let kept: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = lines[i] + (kept.length ? '\n' + kept.join('\n') : '');
    if (wrappedLines(candidate, width) > budget) break;
    kept = [lines[i], ...kept];
  }
  if (kept.length === 0) {
    // First line alone overflows: cut the line by characters to fit.
    const first = lines[lines.length - 1] ?? '';
    let s = first;
    while (s.length > 1 && wrappedLines(s, width) > budget) s = s.slice(Math.floor(s.length / 4));
    return '…' + s;
  }
  return '…' + kept.join('\n');
}

/**
 * v3.4.1: the useful paging ceiling. Scrolling past the moment the window's
 * start reaches index 0 only HIDES the newest messages without revealing
 * anything older — at max scroll the pager showed nothing but the first
 * message (user report: 翻页 10/10 只剩一条). Returns the largest scroll
 * whose window still ends at a position where earlier content exists above
 * (i.e. the first scroll at which start hits 0). Whole conversation fits in
 * one screen → 0 → ↑ is a no-op, exactly as it should feel.
 */
export function maxUsefulScroll(
  messages: readonly MessageData[],
  width: number,
  budget: number,
): number {
  const b = Math.max(1, budget);
  let acc = 0;
  let e = 0;
  while (e < messages.length) {
    const h = estimateMsgLines(messages[e], width);
    if (acc + h > b) break;
    acc += h;
    e++;
  }
  // e = how many oldest messages fit in one window. Paging is useful until
  // the window's end reaches e (earlier content above still exists while
  // end > e). If e === 0 nothing fits — degrade to per-message stepping.
  const firstFit = Math.max(1, e);
  return Math.max(0, messages.length - firstFit);
}

/**
 * Build the visible window ending at `end` (exclusive). `scroll` > 0 moves
 * the end backwards (pager); null = live tail. Clipping is WRAP-aware and
 * iterative: cutting by source-line count alone is a no-op for messages
 * whose lines wrap long (one 720-char CJK line est 27 > budget 25 — the
 * adversarial audit's measured escape). The frame can NEVER grow past the
 * viewport.
 */
export function buildWindow(
  messages: readonly MessageData[],
  scroll: number | null,
  width: number,
  rows: number,
): WindowResult {
  // v3.5.4 (probe round 7): the EFFECTIVE budget callers pass is
  // rows - 9 on the reference layout (input stack measured at 7 rows,
  // frame spare 2) — documented here because the sandbox probes first
  // assumed rows - 8.
  const budget = Math.max(1, rows);
  // Clamp the end into [0, length] — hydrate/resize races can leave a
  // stale scroll larger than the list.
  const end = Math.max(0, Math.min(messages.length - Math.max(0, scroll ?? 0), messages.length));
  const picked: MessageData[] = [];
  let used = 0;
  let i = end;
  while (i > 0) {
    const m = messages[i - 1];
    const h = estimateMsgLines(m, width);
    if (used + h > budget) break;
    picked.unshift(m);
    used += h;
    i--;
  }
  if (picked.length === 0 && end > 0) {
    // The newest message alone overflows the workspace — clip it to the
    // tail by WRAPPED lines until its estimate fits (guaranteed to end:
    // each pass cuts the content in half; budget >= 1 eventually holds
    // even a single wrapped line).
    // v3.5.4 (field report): when tail-clipping drops the FIRST line
    // (e.g. /help's "命令列表:" title), keep it as a header line so a
    // clipped listing still announces itself.
    const m = messages[end - 1];
    let content = m.content;
    const firstLine = content.split('\n')[0];
    let candidate: MessageData = m;
    for (let guard = 0; guard < 32; guard++) {
      const est = estimateMsgLines(candidate, width);
      if (est <= budget) break;
      const lines = content.split('\n');
      if (lines.length <= 1) {
        // One (possibly wrapped) line: cut by characters, keep the tail.
        const keepChars = Math.max(1, Math.floor(content.length * budget / (est + 1)));
        content = '…' + content.slice(content.length - keepChars);
      } else {
        content = '…' + lines.slice(-Math.max(1, Math.floor(lines.length / 2))).join('\n');
      }
      candidate = { ...m, content };
    }
    if (!candidate.content.startsWith(firstLine)) {
      candidate = { ...candidate, content: firstLine + '\n…\n' + candidate.content };
    }
    picked.push(candidate);
    return { messages: picked, start: end - 1, end };
  }
  return { messages: picked, start: i, end };
}

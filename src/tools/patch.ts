/**
 * Apply Patch Tool — Codex V4A-style multi-file patch editing.
 *
 * The model sends ONE patch describing every file change (add / update /
 * move / delete) in Codex's `*** Begin Patch` format. The tool parses it,
 * plans every file's resulting content in memory, asks for a SINGLE
 * confirmation over the whole patch, then writes atomically. Compared with
 * per-file `file write`, this keeps related edits together and forces the
 * model to anchor each change with context lines, which kills the
 * "rewrite the whole file and silently drop unrelated code" failure mode.
 *
 * Patch grammar (Codex V4A):
 *
 *   *** Begin Patch
 *   *** Add File: <path>
 *   +new line
 *   *** Update File: <path>
 *   *** Move to: <new path>
 *   @@ optional anchor (ignored, kept for readability)
 *    context line
 *   -removed line
 *   +added line
 *   *** Delete File: <path>
 *   *** End Patch
 *
 * Matching: hunks are located by their context+removed lines — exact match
 * first, then trailing-whitespace-tolerant, then fully-trimmed. Hunks apply
 * in order and must appear at non-decreasing positions, matching Codex
 * semantics.
 */

import type { Tool, ToolResult, ToolContext } from './types.js';
import { readFileSync, writeFileSync, existsSync, unlinkSync, renameSync, mkdirSync, statSync } from 'fs';
import { dirname, isAbsolute, relative, resolve } from 'path';

// ── types ──────────────────────────────────────────────────

interface ChangeLine { type: 'context' | 'add' | 'remove'; text: string }
interface PatchHunk { changes: ChangeLine[] }
interface FilePatch {
  kind: 'add' | 'update' | 'delete';
  path: string;
  moveTo?: string;
  hunks: PatchHunk[];
}

// ── parser ─────────────────────────────────────────────────

const BEGIN = '*** Begin Patch';
const END = '*** End Patch';
const ADD = '*** Add File: ';
const UPDATE = '*** Update File: ';
const DELETE = '*** Delete File: ';
const MOVE = '*** Move to: ';

export class PatchParseError extends Error {}

/** Split raw patch text into per-file operations. Throws PatchParseError. */
export function parsePatch(input: string): FilePatch[] {
  const lines = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if ((lines[i] || '').trim() !== BEGIN) {
    throw new PatchParseError(`[PATCH_ERROR] 补丁必须以 "${BEGIN}" 开头（收到: ${(lines[i] || '').trim().slice(0, 40) || '空'}）`);
  }
  i++;

  const files: FilePatch[] = [];
  let current: FilePatch | null = null;
  let hunk: PatchHunk | null = null;
  let sawEnd = false;

  const clean = (s: string) => s.replace(/\s+$/, '');
  const parsePath = (raw: string, where: string): string => {
    const p = clean(raw).trim();
    if (!p) throw new PatchParseError(`[PATCH_ERROR] ${where} 缺少文件路径`);
    if (/[\u0000-\u001f]/.test(p)) throw new PatchParseError(`[PATCH_ERROR] ${where} 路径含非法控制字符`);
    if (p.startsWith('~')) throw new PatchParseError(`[PATCH_ERROR] ${where} 不支持 ~ 路径，请用仓库内相对路径`);
    return p.replace(/\\/g, '/');
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = clean(line);

    if (trimmed === END) { sawEnd = true; i++; break; }

    if (trimmed.startsWith(ADD) || trimmed.startsWith(UPDATE) || trimmed.startsWith(DELETE)) {
      hunk = null;
      const kind: FilePatch['kind'] = trimmed.startsWith(ADD) ? 'add'
        : trimmed.startsWith(UPDATE) ? 'update' : 'delete';
      const path = parsePath(trimmed.slice(trimmed.indexOf(':') + 1), trimmed.split(':')[0]);
      if (files.some(f => f.path === path)) {
        throw new PatchParseError(`[PATCH_ERROR] 同一文件在补丁中出现两次: ${path}`);
      }
      current = { kind, path, hunks: [] };
      files.push(current);
      continue;
    }

    if (trimmed.startsWith(MOVE)) {
      if (!current || current.kind !== 'update') {
        throw new PatchParseError('[PATCH_ERROR] "*** Move to:" 只能出现在 "*** Update File:" 之后');
      }
      current.moveTo = parsePath(trimmed.slice(MOVE.length), 'Move to');
      continue;
    }

    if (trimmed === '') {
      // Blank line inside a hunk = empty context line; between/before
      // sections = noise.
      if (hunk && current?.kind === 'update') {
        hunk.changes.push({ type: 'context', text: '' });
      }
      continue;
    }

    if (!current) {
      throw new PatchParseError(`[PATCH_ERROR] 文件操作之外出现行内容: "${trimmed.slice(0, 40)}"`);
    }

    // Hunk marker (Codex tolerates empty anchor after @@). A non-empty
    // anchor (`@@ def main():`) acts as a LOCATING context line — Codex
    // semantics — so it joins the hunk as its first context line.
    if (trimmed.startsWith('@@')) {
      if (current.kind !== 'update') {
        throw new PatchParseError(`[PATCH_ERROR] @@ 块只能用于 Update File（当前: ${current.path}）`);
      }
      hunk = { changes: [] };
      const anchor = trimmed.slice(2).trim();
      if (anchor) hunk.changes.push({ type: 'context', text: anchor });
      current.hunks.push(hunk);
      continue;
    }

    // Hunk content lines.
    const marker = line[0];
    if (marker === ' ' || marker === '+' || marker === '-') {
      if (current.kind === 'add' && marker !== '+') {
        throw new PatchParseError(`[PATCH_ERROR] Add File 的内容必须以 "+" 开头（文件 ${current.path}）`);
      }
      if (current.kind === 'delete') {
        throw new PatchParseError(`[PATCH_ERROR] Delete File 不接受内容行（文件 ${current.path}）`);
      }
      if (!hunk) {
        if (current.kind === 'update') {
          throw new PatchParseError(`[PATCH_ERROR] Update File 的内容行必须位于 @@ 块内（文件 ${current.path}）`);
        }
        // Add File without an @@ header: open an implicit hunk.
        hunk = { changes: [] };
        current.hunks.push(hunk);
      }
      hunk.changes.push({
        type: marker === ' ' ? 'context' : marker === '+' ? 'add' : 'remove',
        text: line.slice(1).replace(/\s+$/, ''),
      });
      continue;
    }

    throw new PatchParseError(`[PATCH_ERROR] 无法识别的行（应以 空格/+/- 开头或为 *** 指令）: "${line.slice(0, 60)}"`);
  }

  if (!sawEnd && i < lines.length && lines.slice(i).some(l => l.trim() !== '')) {
    throw new PatchParseError(`[PATCH_ERROR] "${END}" 之后仍有内容`);
  }
  if (files.length === 0) {
    throw new PatchParseError('[PATCH_ERROR] 补丁为空：至少需要一个 Add/Update/Delete File 段');
  }
  for (const f of files) {
    if (f.kind !== 'delete' && f.hunks.length === 0) {
      throw new PatchParseError(`[PATCH_ERROR] ${f.path}: 没有 @@ 修改块（Update File 至少要有一个含上下文的 hunk）`);
    }
    for (const h of f.hunks) {
      if (h.changes.length === 0) {
        throw new PatchParseError(`[PATCH_ERROR] ${f.path}: 存在空 hunk`);
      }
    }
  }
  return files;
}

// ── hunk matching / application ────────────────────────────

interface HunkMatch { index: number; quality: 'exact' | 'trimEnd' | 'trim' }

/**
 * Unicode punctuation normalization — match-forgiveness level 4 (Codex
 * seek_sequence parity): models sometimes emit curly quotes, fancy dashes
 * or non-breaking spaces inside context lines. Map them to their ASCII
 * counterparts before the last-chance comparison.
 */
function normalizePunct(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2012\u2013\u2014\u2015\u2212\uFE63\uFF0D]/g, '-')
    .replace(/[\u00A0\u2007\u202F\u3000]/g, ' ');
}

function matchHunk(fileLines: string[], pattern: string[], from: number): HunkMatch | null {
  if (pattern.length === 0 || pattern.length > fileLines.length) return null;
  const attempts: Array<(a: string, b: string) => boolean> = [
    (a, b) => a === b,
    (a, b) => a.trimEnd() === b.trimEnd(),
    (a, b) => a.trim() === b.trim(),
    (a, b) => normalizePunct(a.trim()) === normalizePunct(b.trim()),
  ];
  for (let level = 0; level < attempts.length; level++) {
    const eq = attempts[level];
    for (let idx = from; idx <= fileLines.length - pattern.length; idx++) {
      let ok = true;
      for (let j = 0; j < pattern.length; j++) {
        if (!eq(fileLines[idx + j], pattern[j])) { ok = false; break; }
      }
      if (ok) return { index: idx, quality: level === 0 ? 'exact' : level === 1 ? 'trimEnd' : 'trim' };
    }
  }
  return null;
}

export interface PlannedFile {
  patch: FilePatch;
  /** Absolute path the (possibly moved) result will be written to. */
  finalPath: string;
  /** Resulting file content (null for delete). */
  resultContent: string | null;
  originalPath: string;
  existed: boolean;
  added: number;
  removed: number;
}

/** Resolve a patch-relative path against the working directory. */
export function resolvePatchPath(p: string, workdir: string): string {
  return isAbsolute(p) || /^[a-zA-Z]:[\\/]/.test(p) ? resolve(p) : resolve(workdir, p);
}

function applyHunksToLines(fileLines: string[], patch: FilePatch): { lines: string[]; added: number; removed: number } {
  let lines = [...fileLines];
  let searchFrom = 0;
  let added = 0;
  let removed = 0;
  for (let hi = 0; hi < patch.hunks.length; hi++) {
    const hunk = patch.hunks[hi];
    // pattern = what must already be in the file (context + removed lines);
    // replacementSpec = what the hunk becomes (context + added lines), where
    // context entries remember their position in `pattern` so a fuzzy match
    // can reuse the FILE's original line (preserving e.g. trailing spaces)
    // instead of the patch's normalized copy.
    const pattern: string[] = [];
    const replacementSpec: Array<{ kind: 'context' | 'add'; patternPos: number; text: string }> = [];
    for (const c of hunk.changes) {
      if (c.type === 'add') {
        replacementSpec.push({ kind: 'add', patternPos: -1, text: c.text });
      } else if (c.type === 'context') {
        replacementSpec.push({ kind: 'context', patternPos: pattern.length, text: c.text });
        pattern.push(c.text);
      } else {
        // removed line: participates in the match only — never re-emitted.
        pattern.push(c.text);
      }
    }
    if (pattern.length === 0) {
      throw new PatchParseError(
        `[PATCH_ERROR] ${patch.path} 第 ${hi + 1} 个 hunk 没有上下文行 — 请在 @@ 后保留修改点前后的原文行，位置才不会歧义`,
      );
    }
    const m = matchHunk(lines, pattern, searchFrom);
    if (!m) {
      const around = pattern.slice(0, 3).map(l => `    │ ${l}`).join('\n');
      throw new PatchParseError(
        `[PATCH_ERROR] ${patch.path} 第 ${hi + 1} 个 hunk 在文件中匹配不到（从第 ${searchFrom + 1} 行起）。请重新读取文件后用准确的上下文行重试。开头上下文:\n${around}`,
      );
    }
    const replacement = replacementSpec.map(spec =>
      spec.kind === 'add' ? spec.text : (m.quality === 'exact' ? spec.text : lines[m.index + spec.patternPos]),
    );
    lines.splice(m.index, pattern.length, ...replacement);
    searchFrom = m.index + replacement.length;
    added += hunk.changes.filter(c => c.type === 'add').length;
    removed += hunk.changes.filter(c => c.type === 'remove').length;
  }
  return { lines, added, removed };
}

/** Plan every file's final content in memory (no writes). Throws PatchParseError. */
export function planPatch(files: FilePatch[], workdir: string): PlannedFile[] {
  const planned: PlannedFile[] = [];
  const contents = new Map<string, string[]>(); // absolute path → current lines (within this patch)

  const readLines = (abs: string): { lines: string[]; existed: boolean; crlf: boolean } => {
    if (contents.has(abs)) return { lines: contents.get(abs)!, existed: true, crlf: false };
    if (!existsSync(abs)) return { lines: [], existed: false, crlf: false };
    const raw = readFileSync(abs, 'utf-8');
    const crlf = raw.includes('\r\n');
    const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    return { lines, existed: true, crlf };
  };

  for (const f of files) {
    const abs = resolvePatchPath(f.path, workdir);
    const finalAbs = f.moveTo ? resolvePatchPath(f.moveTo, workdir) : abs;
    if (statSafe(abs) === 'dir' || statSafe(finalAbs) === 'dir') {
      throw new PatchParseError(`[PATCH_ERROR] 目标是目录而不是文件: ${f.moveTo || f.path}`);
    }

    if (f.kind === 'delete') {
      const { lines, existed } = readLines(abs);
      if (!existed) throw new PatchParseError(`[PATCH_ERROR] Delete File: 文件不存在 ${f.path}`);
      contents.set(abs, []);
      planned.push({ patch: f, finalPath: finalAbs, resultContent: null, originalPath: abs, existed: true, added: 0, removed: lines.length });
      continue;
    }

    if (f.kind === 'add') {
      if (existsSync(abs)) throw new PatchParseError(`[PATCH_ERROR] Add File: 文件已存在 ${f.path}（要修改请用 Update File）`);
      const addLines = f.hunks.flatMap(h => h.changes.filter(c => c.type === 'add').map(c => c.text));
      const text = addLines.length ? addLines.join('\n') + '\n' : '';
      contents.set(abs, addLines);
      planned.push({ patch: f, finalPath: finalAbs, resultContent: text, originalPath: abs, existed: false, added: addLines.length, removed: 0 });
      continue;
    }

    // update
    const { lines, existed, crlf } = readLines(abs);
    if (!existed) throw new PatchParseError(`[PATCH_ERROR] Update File: 文件不存在 ${f.path}`);
    const { lines: out, added, removed } = applyHunksToLines(lines, f);
    const text = (crlf ? out.join('\r\n') : out.join('\n'));
    contents.set(abs, out);
    planned.push({ patch: f, finalPath: finalAbs, resultContent: text, originalPath: abs, existed: true, added, removed });
  }
  return planned;
}

function statSafe(p: string): 'file' | 'dir' | 'none' {
  try {
    const s = statSync(p);
    return s.isDirectory() ? 'dir' : 'file';
  } catch {
    return 'none';
  }
}

// ── preview / confirmation ─────────────────────────────────

const PREVIEW_LINE_CAP = 40;

export function buildPatchSummary(planned: PlannedFile[], workdir: string): string {
  const rel = (p: string) => {
    const r = relative(workdir, p);
    return r && !r.startsWith('..') ? r.replace(/\\/g, '/') : p.replace(/\\/g, '/');
  };
  const heads = planned.map(p => {
    if (p.patch.kind === 'delete') return `- 删除 ${rel(p.originalPath)}（${p.removed} 行）`;
    const label = p.patch.kind === 'add' ? '+ 新建' : '~ 修改';
    const move = p.patch.moveTo ? ` → ${rel(p.finalPath)}` : '';
    return `${label} ${rel(p.originalPath)}${move}（+${p.added} −${p.removed} 行）`;
  });

  const previewLines: string[] = [];
  outer: for (const p of planned) {
    if (p.patch.kind === 'add') {
      const content = (p.resultContent || '').split('\n');
      previewLines.push(`┌ ${rel(p.originalPath)}`);
      for (const l of content.slice(0, Math.min(12, PREVIEW_LINE_CAP - previewLines.length))) {
        if (l) previewLines.push(`+ ${l}`);
      }
      previewLines.push('└ …');
    } else if (p.patch.kind === 'update') {
      const hunk = p.patch.hunks[0];
      previewLines.push(`┌ ${rel(p.originalPath)} @@`);
      for (const c of hunk.changes) {
        if (previewLines.length >= PREVIEW_LINE_CAP) { previewLines.push('  …'); break outer; }
        previewLines.push(`${c.type === 'add' ? '+' : c.type === 'remove' ? '-' : ' '} ${c.text}`);
      }
    }
    if (previewLines.length >= PREVIEW_LINE_CAP) { previewLines.push('  …'); break; }
  }

  return ['应用补丁（一次确认，全部生效）:', ...heads.map(h => '  ' + h), '', ...previewLines].join('\n');
}

// ── tool ───────────────────────────────────────────────────

export class ApplyPatchTool implements Tool {
  name = 'apply_patch';
  description = [
    'Apply a multi-file code patch in ONE atomic, confirmed operation. This is the preferred way to edit existing code.',
    'Format:',
    '*** Begin Patch',
    '*** Add File: relative/path.ext',
    '+full new file content (every line prefixed +)',
    '*** Update File: relative/path.ext',
    '*** Move to: new/path.ext  (optional rename)',
    '@@',
    ' unchanged context line (2-4 lines around the edit REQUIRED)',
    '-old line',
    '+new line',
    '*** Delete File: relative/path.ext',
    '*** End Patch.',
    'Rules: paths are workspace-relative; context lines must match the file exactly (trailing whitespace tolerated);',
    'multiple @@ hunks per file apply in order; the whole patch is validated before anything is written.',
  ].join(' ');

  inputSchema = {
    type: 'object' as const,
    properties: {
      patch: { type: 'string', description: 'The full *** Begin Patch … *** End Patch text' },
    },
    required: ['patch'],
  };

  metadata = {
    permissions: ['write' as const],
    tags: ['file', 'patch', 'edit'],
    maxDuration: 30000,
    version: '1.0.0',
  };

  parameters = [
    { name: 'patch', type: 'string', description: 'Full patch text in *** Begin Patch / *** End Patch format', required: true },
  ];

  async execute(params: Record<string, any>, ctx?: ToolContext): Promise<ToolResult> {
    const patchText = params?.patch;
    if (typeof patchText !== 'string' || !patchText.trim()) {
      return { success: false, error: '[PARAM_ERROR] "patch" is required and must be the full patch text.' };
    }

    const workdir = ctx?.workingDirectory || process.cwd();

    let planned: PlannedFile[];
    try {
      planned = planPatch(parsePatch(patchText), workdir);
    } catch (e: any) {
      if (e instanceof PatchParseError) return { success: false, error: e.message };
      throw e;
    }

    // Single confirmation over the WHOLE patch (Codex apply_patch approval).
    // Fail closed when no confirmation channel exists (headless without --yolo).
    if (ctx?.confirmAction) {
      const ok = await ctx.confirmAction(buildPatchSummary(planned, workdir));
      if (!ok) {
        return { success: false, error: 'Patch cancelled by user — no files were modified.' };
      }
    } else {
      return { success: false, error: 'apply_patch requires confirmation, but no confirmation channel is available (headless? add --yolo)' };
    }

    const touched: string[] = [];
    let totalAdded = 0;
    let totalRemoved = 0;
    try {
      for (const p of planned) {
        if (p.patch.kind === 'delete') {
          unlinkSync(p.originalPath);
          touched.push(`− ${p.originalPath}`);
        } else {
          const dir = dirname(p.finalPath);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          if (p.patch.kind === 'update' && p.finalPath !== p.originalPath && existsSync(p.originalPath)) {
            writeFileSync(p.finalPath, p.resultContent!, 'utf-8');
            unlinkSync(p.originalPath);
          } else {
            writeFileSync(p.finalPath, p.resultContent!, 'utf-8');
          }
          touched.push(`${p.patch.kind === 'add' ? '+' : '~'} ${p.finalPath}`);
        }
        totalAdded += p.added;
        totalRemoved += p.removed;
      }
    } catch (error: any) {
      return { success: false, error: `Patch partially applied before failure: ${error.message}. Applied so far: ${touched.join(', ') || 'none'}.` };
    }

    const names = planned.map(p => p.patch.moveTo || p.patch.path).join(', ');
    return {
      success: true,
      output: `Applied patch to ${planned.length} file(s): +${totalAdded} −${totalRemoved} lines (${names})`,
      data: { files: planned.map(p => ({ path: p.patch.moveTo || p.patch.path, kind: p.patch.kind, added: p.added, removed: p.removed })) },
    };
  }
}

// re-export for tests
export { PatchParseError as _PatchParseError };

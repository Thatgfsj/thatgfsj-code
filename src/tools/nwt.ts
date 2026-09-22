/**
 * NeuroWeave Timeline (NWT) Tool - Project evolution memory
 * Built-in port of https://github.com/Thatgfsj/neuroweave-timeline
 *
 * Stores meaningful actions (decisions, refactors, bug fixes) as timeline events
 * in .nwt/ directory. Supports monthly archives (max 1 month per archive).
 */

import type { Tool, ToolResult } from './types.js';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
  readdirSync, renameSync, unlinkSync, copyFileSync, rmSync
} from 'fs';
import { join } from 'path';

interface TimelineEvent {
  id: string;
  timestamp: string;
  task: string;
  summary: string;
  reason?: string;
  files: string[];
  tags: string[];
  parent?: string;
  importance: 'low' | 'normal' | 'high' | 'milestone';
}

const NWT_DIR = '.nwt';
const EVENTS_DIR = 'events';
const ARCHIVE_DIR = 'archives';
const SNAPSHOT_DIR = 'snapshots';
const MAX_SNAPSHOTS = 5;
const MAX_EVENTS = 500;
const ARCHIVE_AFTER_DAYS = 30;

/** v0.2.0 parity: paths are normalized to POSIX form on save so
 * `src\foo.ts` and `src/foo.ts` index/explain under one key. */
const toPosix = (p: string) => p.trim().replace(/\\/g, '/');

export class NwtTool implements Tool {
  name = 'nwt';
  description = `NeuroWeave Timeline - Project evolution memory.
Actions: init, log, history, search, story, explain, archive, diff, compact

log auto-chains: the new event's parent defaults to the latest event.
Pass parent="none" to start an explicit branch, or parent="<id>" to attach
to a specific event.

AUTO-LOG TRIGGERS (call nwt log silently when):
- Created, modified, or deleted 2+ files
- Made an architectural decision (chose a library, pattern, or approach)
- Fixed a bug
- Added a new feature or capability
- Refactored existing code
- Set up a new project or module
- Resolved a security issue
- Completed a multi-step task

DO NOT log:
- Simple file reads or searches
- Trivial single-line changes
- Conversational questions with no code changes`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        description: 'Action: init, log, history, search, story, explain, archive, diff, compact',
      },
      task: { type: 'string', description: 'Short imperative title (for log)' },
      summary: { type: 'string', description: 'What was done (for log)' },
      reason: { type: 'string', description: 'Why it was done (for log)' },
      files: { type: 'string', description: 'Comma-separated file paths (for log)' },
      tags: { type: 'string', description: 'Comma-separated tags (for log)' },
      importance: { type: 'string', description: 'Importance: low, normal, high, milestone (for log)' },
      parent: { type: 'string', description: 'Parent event ID for log; "none" starts a branch; default = latest event' },
      query: { type: 'string', description: 'Search query (for search/explain)' },
      limit: { type: 'number', description: 'Max results (for history/search)' },
      from_id: { type: 'string', description: 'Start event ID (for diff)' },
      to_id: { type: 'string', description: 'End event ID (for diff)' },
    },
    required: ['action'],
  };

  metadata = {
    permissions: ['read', 'write'] as ('read' | 'write' | 'execute' | 'network')[],
    tags: ['nwt', 'timeline', 'memory', 'history'],
  };

  parameters = [
    { name: 'action', type: 'string', description: 'Action to perform', required: true },
    { name: 'task', type: 'string', description: 'Short title', required: false },
    { name: 'summary', type: 'string', description: 'What was done', required: false },
    { name: 'reason', type: 'string', description: 'Why it was done', required: false },
    { name: 'files', type: 'string', description: 'Comma-separated file paths', required: false },
    { name: 'tags', type: 'string', description: 'Comma-separated tags', required: false },
    { name: 'importance', type: 'string', description: 'low/normal/high/milestone', required: false },
    { name: 'parent', type: 'string', description: 'Parent event ID; "none" starts a branch; default = latest', required: false },
    { name: 'query', type: 'string', description: 'Search query', required: false },
    { name: 'limit', type: 'number', description: 'Max results', required: false },
    { name: 'from_id', type: 'string', description: 'Start event ID for diff', required: false },
    { name: 'to_id', type: 'string', description: 'End event ID for diff', required: false },
  ];

  async execute(params: Record<string, any>, ctx?: any): Promise<ToolResult> {
    // v3.5.4 (field report): nwt was the only tool with NO output cap — a
    // single 618K-char history dump went straight onto the wire and could
    // blow the context window (provider 400). Cap like the shell tool.
    const result = await this.executeInner(params, ctx);
    if (result.success && typeof result.output === 'string' && result.output.length > 8000) {
      const n = result.output.length;
      result.output =
        result.output.slice(0, 6000) +
        `\n...[输出截断，省略 ${n - 7000} 字符；用 limit 参数缩小范围]...\n` +
        result.output.slice(-1000);
    }
    return result;
  }

  private async executeInner(params: Record<string, any>, ctx?: any): Promise<ToolResult> {
    const cwd = ctx?.workingDirectory || process.cwd();
    const action = params.action;

    // v3.1.0: plan-mode read-only gate. nwt writes directly to .nwt/ without
    // a confirmation round-trip, so it must consult ctx.readOnly itself.
    if (['init', 'log', 'archive', 'compact'].includes(action) && ctx?.readOnly?.()) {
      return {
        success: false,
        error: '计划模式（只读）：NWT 写入已被拒绝。请继续研究与列计划；批准计划后再补记事件。',
      };
    }

    try {
      switch (action) {
        case 'init':
          return this.init(cwd);
        case 'log':
          return this.log(cwd, params);
        case 'history':
          return this.history(cwd, params.limit || 20);
        case 'search':
          return this.search(cwd, params.query || '', params.limit || 20);
        case 'story':
          return this.story(cwd);
        case 'explain':
          return this.explain(cwd, params.query || '');
        case 'archive':
          return this.archive(cwd);
        case 'diff':
          return this.diff(cwd, params.from_id || '', params.to_id || '');
        case 'compact':
          return this.compact(cwd);
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ── Init ──────────────────────────────────────────────

  private init(cwd: string): ToolResult {
    const nwtDir = join(cwd, NWT_DIR);
    const eventsDir = join(nwtDir, EVENTS_DIR);
    const archiveDir = join(nwtDir, ARCHIVE_DIR);

    if (!existsSync(nwtDir)) mkdirSync(nwtDir, { recursive: true });
    if (!existsSync(eventsDir)) mkdirSync(eventsDir, { recursive: true });
    if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });

    // Auto-archive events older than 30 days on every init
    this.autoArchiveIfNeeded(cwd);

    // Write metadata
    const meta = {
      version: '2.0.0',
      created: new Date().toISOString(),
      description: 'NeuroWeave Timeline - Project evolution memory',
    };
    writeFileSync(join(nwtDir, 'meta.json'), JSON.stringify(meta, null, 2));

    return { success: true, output: 'NWT initialized in .nwt/' };
  }

  // ── Log Event ─────────────────────────────────────────

  private log(cwd: string, params: Record<string, any>): ToolResult {
    const nwtDir = join(cwd, NWT_DIR);
    if (!existsSync(nwtDir)) {
      this.init(cwd);
    }

    const { task, summary, reason, files, tags, importance } = params;
    if (!task || !summary) {
      return { success: false, error: 'task and summary are required' };
    }

    // Get next ID
    // v3.0.5: was `existing.length + 1`, which reuses IDs after an
    // archive/compact shrinks the events dir — silently OVERWRITING older
    // events. Derive the ID from the highest existing number instead.
    const eventsDir = join(nwtDir, EVENTS_DIR);
    const existing = existsSync(eventsDir)
      ? readdirSync(eventsDir).filter(f => f.endsWith('.json'))
      : [];
    const maxId = existing.reduce((max, f) => {
      const n = parseInt(f.replace('.json', ''), 10);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 0);
    const nextId = (maxId + 1).toString().padStart(6, '0');

    // v0.2.0 parity (auto-chaining): default parent = latest event (highest
    // id, not filename sort); parent="none" starts an explicit branch;
    // parent="<id>" attaches to a validated event.
    const parentParam = typeof params.parent === 'string' ? params.parent.trim() : '';
    let parent: string | undefined;
    if (parentParam.toLowerCase() === 'none') {
      parent = undefined;
    } else if (parentParam) {
      const cand = parentParam.padStart(6, '0');
      if (!existing.includes(`${cand}.json`)) {
        return { success: false, error: `Parent event ${parentParam} not found. Use parent="none" to start a branch.` };
      }
      parent = cand;
    } else if (maxId > 0) {
      // v3.5.4: trust but verify — a corrupt/junk file can hold the highest
      // number; chaining onto an unreadable event creates a dangling parent
      // (and after a compact renumber, even a self-reference).
      const cand = maxId.toString().padStart(6, '0');
      try {
        const raw = JSON.parse(readFileSync(join(eventsDir, `${cand}.json`), 'utf-8'));
        if (raw && typeof raw.id === 'string' && raw.id !== nextId) parent = cand;
      } catch {
        parent = undefined;
      }
    }

    // Validate importance
    const validImportance = ['low', 'normal', 'high', 'milestone'];
    const eventImportance = validImportance.includes(importance) ? importance : 'normal';

    const event: TimelineEvent = {
      id: nextId,
      timestamp: new Date().toISOString(),
      task: task.trim(),
      summary: summary.trim(),
      reason: reason?.trim() || undefined,
      files: files ? files.split(',').map((f: string) => toPosix(f)).filter(Boolean) : [],
      tags: tags ? tags.split(',').map((t: string) => t.trim().toLowerCase()).filter(Boolean) : [],
      parent: parent || undefined,
      importance: eventImportance as TimelineEvent['importance'],
    };

    writeFileSync(
      join(eventsDir, `${nextId}.json`),
      JSON.stringify(event, null, 2)
    );

    // Auto-archive if too many events
    if (existing.length >= MAX_EVENTS) {
      this.archive(cwd);
    }

    return {
      success: true,
      output: `Event [${nextId}] logged: ${event.task}`,
    };
  }

  // ── History ───────────────────────────────────────────

  private history(cwd: string, limit: number): ToolResult {
    const events = this.loadEvents(cwd);
    if (events.length === 0) {
      return { success: true, output: 'No events yet. Use nwt log to start tracking.' };
    }

    const recent = events.slice(-limit);
    const lines = recent.map(e => {
      const time = e.timestamp.split('T')[0];
      const files = e.files.length > 0 ? ` [${e.files.join(', ')}]` : '';
      const tags = e.tags.length > 0 ? ` {${e.tags.join(', ')}}` : '';
      const imp = e.importance && e.importance !== 'normal' ? ` (${e.importance})` : '';
      return `[${e.id}] ${time} ${e.task}${imp}${files}${tags}`;
    });

    return { success: true, output: lines.join('\n') };
  }

  // ── Search ────────────────────────────────────────────

  private search(cwd: string, query: string, limit: number): ToolResult {
    if (!query) return { success: false, error: 'query is required' };

    const events = this.loadEvents(cwd);
    const q = query.toLowerCase();
    const matches = events.filter(e =>
      e.task.toLowerCase().includes(q) ||
      e.summary.toLowerCase().includes(q) ||
      (e.reason || '').toLowerCase().includes(q) ||
      e.files.some(f => f.toLowerCase().includes(q)) ||
      e.tags.some(t => t.includes(q))
    ).slice(-limit);

    if (matches.length === 0) {
      return { success: true, output: `No events matching "${query}"` };
    }

    const lines = matches.map(e => {
      const time = e.timestamp.split('T')[0];
      return `[${e.id}] ${time} ${e.task}\n    ${e.summary}`;
    });

    return { success: true, output: lines.join('\n\n') };
  }

  // ── Story ─────────────────────────────────────────────

  private story(cwd: string): ToolResult {
    const events = this.loadEvents(cwd);
    if (events.length === 0) {
      return { success: true, output: 'No events yet.' };
    }

    // Group by importance
    const milestones = events.filter(e => e.importance === 'milestone' || e.tags.includes('milestone'));
    const highImportance = events.filter(e => e.importance === 'high');
    const decisions = events.filter(e => e.tags.includes('decision'));
    const totalFiles = new Set(events.flatMap(e => e.files)).size;

    const lines = [
      `Project Story: ${events.length} events, ${totalFiles} files touched`,
      '',
    ];

    if (milestones.length > 0) {
      lines.push('Milestones:');
      for (const m of milestones.slice(-5)) {
        lines.push(`  [${m.id}] ${m.task} - ${m.summary}`);
      }
      lines.push('');
    }

    if (highImportance.length > 0) {
      lines.push('High Importance:');
      for (const h of highImportance.slice(-5)) {
        lines.push(`  [${h.id}] ${h.task} - ${h.summary}`);
      }
      lines.push('');
    }

    if (decisions.length > 0) {
      lines.push('Key Decisions:');
      for (const d of decisions.slice(-5)) {
        lines.push(`  [${d.id}] ${d.task}${d.reason ? ` - ${d.reason}` : ''}`);
      }
      lines.push('');
    }

    lines.push('Recent Activity:');
    for (const e of events.slice(-5)) {
      const time = e.timestamp.split('T')[0];
      const imp = e.importance && e.importance !== 'normal' ? ` (${e.importance})` : '';
      lines.push(`  ${time} ${e.task}${imp}`);
    }

    return { success: true, output: lines.join('\n') };
  }

  // ── Explain File ──────────────────────────────────────

  private explain(cwd: string, filePath: string): ToolResult {
    if (!filePath) return { success: false, error: 'file path is required' };

    const events = this.loadEvents(cwd);
    const matches = events.filter(e =>
      e.files.some(f => f === filePath || f.endsWith(filePath))
    );

    if (matches.length === 0) {
      return { success: true, output: `No history for "${filePath}"` };
    }

    const lines = matches.map(e => {
      const time = e.timestamp.split('T')[0];
      return `[${e.id}] ${time} ${e.task}\n    ${e.summary}${e.reason ? `\n    Reason: ${e.reason}` : ''}`;
    });

    return { success: true, output: `History of ${filePath}:\n\n${lines.join('\n\n')}` };
  }

  // ── Diff ──────────────────────────────────────────────

  private diff(cwd: string, fromId: string, toId: string): ToolResult {
    if (!fromId || !toId) {
      return { success: false, error: 'from_id and to_id are required' };
    }

    const events = this.loadEvents(cwd);
    const fromEvent = events.find(e => e.id === fromId.padStart(6, '0'));
    const toEvent = events.find(e => e.id === toId.padStart(6, '0'));

    if (!fromEvent) return { success: false, error: `Event ${fromId} not found` };
    if (!toEvent) return { success: false, error: `Event ${toId} not found` };

    // Get events between from and to. v0.2.0 parity: a reversed range is a
    // clean validation error (it used to silently produce an empty diff).
    const fromIdx = events.indexOf(fromEvent);
    const toIdx = events.indexOf(toEvent);
    if (fromIdx > toIdx) {
      return { success: false, error: `Reversed range: ${fromEvent.id} is newer than ${toEvent.id}. Swap from_id and to_id.` };
    }
    const between = events.slice(fromIdx, toIdx + 1);

    // Collect all files touched
    const allFiles = new Set(between.flatMap(e => e.files));
    const fromFiles = new Set(fromEvent.files);
    const toFiles = new Set(toEvent.files);

    // Files added/removed/modified
    const added = [...toFiles].filter(f => !fromFiles.has(f));
    const removed = [...fromFiles].filter(f => !toFiles.has(f));
    const modified = [...allFiles].filter(f => fromFiles.has(f) && toFiles.has(f));

    const lines = [
      `Diff: [${fromEvent.id}] → [${toEvent.id}]`,
      `Events: ${between.length} between these points`,
      '',
    ];

    if (added.length > 0) lines.push(`Added: ${added.join(', ')}`);
    if (removed.length > 0) lines.push(`Removed: ${removed.join(', ')}`);
    if (modified.length > 0) lines.push(`Modified: ${modified.join(', ')}`);

    lines.push('', 'Events in range:');
    for (const e of between) {
      const time = e.timestamp.split('T')[0];
      lines.push(`  [${e.id}] ${time} ${e.task}`);
    }

    return { success: true, output: lines.join('\n') };
  }

  // ── Compact ───────────────────────────────────────────

  private compact(cwd: string): ToolResult {
    const events = this.loadEvents(cwd);
    if (events.length < 10) {
      return { success: true, output: 'Not enough events to compact (need 10+).' };
    }

    const nwtDir = join(cwd, NWT_DIR);
    const eventsDir = join(nwtDir, EVENTS_DIR);

    // v0.2.0 parity (corruption fix): snapshot the store BEFORE touching it
    // — compact renumbers ids, so a mid-write failure must stay recoverable.
    this.snapshotEvents(nwtDir, eventsDir);

    // Group consecutive events with same tags
    const chains: TimelineEvent[][] = [];
    let chain: TimelineEvent[] = [events[0]];

    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const curr = events[i];

      // Same tags and close in time (within 1 hour)
      const sameTags = curr.tags.join(',') === prev.tags.join(',');
      const timeDiff = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
      const closeInTime = timeDiff < 3600000; // 1 hour

      if (sameTags && closeInTime) {
        chain.push(curr);
      } else {
        chains.push(chain);
        chain = [curr];
      }
    }
    chains.push(chain);

    // Merge chains with 3+ events
    let merged = 0;
    const survivors: TimelineEvent[] = [];
    /** merged-away event id → the survivor (group head) that absorbed it. */
    const absorbedBy = new Map<string, string>();

    for (const group of chains) {
      if (group.length >= 3) {
        // Merge into one summary event. The first event's task/reason/parent
        // carry over so the merged event stays anchored in the chain.
        const first = group[0];
        const last = group[group.length - 1];
        const allFiles = [...new Set(group.flatMap(e => e.files))];
        const allTags = [...new Set(group.flatMap(e => e.tags))];

        survivors.push({
          id: first.id,
          timestamp: first.timestamp,
          task: `${first.task} … ${last.task}`,
          summary: `Compacted ${group.length} events: ${group.map(e => e.task).join(', ')}`,
          reason: first.reason,
          files: allFiles,
          tags: allTags,
          parent: first.parent,
          importance: first.importance === 'milestone' ? 'milestone'
            : group.some(e => e.importance === 'milestone') ? 'milestone'
              : first.importance,
        });
        for (const e of group) absorbedBy.set(e.id, first.id);
        merged += group.length - 1;
      } else {
        survivors.push(...group);
      }
    }

    if (merged === 0) {
      return { success: true, output: 'No events to compact.' };
    }

    // Renumber contiguously and REMAP parent references (v0.2.0 corruption
    // fix: renumbering used to leave parent fields pointing at ids that no
    // longer exist). Parents pointing at merged-away events resolve to the
    // absorbing survivor's new id; parents outside the store stay untouched.
    const idMap = new Map<string, string>();
    const renumbered: TimelineEvent[] = [];
    survivors.forEach((e, i) => {
      const newId = (i + 1).toString().padStart(6, '0');
      idMap.set(e.id, newId);
      renumbered.push({ ...e, id: newId });
    });
    for (const e of renumbered) {
      if (!e.parent) continue;
      const resolved = absorbedBy.get(e.parent) ?? e.parent;
      if (idMap.has(resolved)) {
        e.parent = idMap.get(resolved);
      }
    }

    // Rewrite the store: write the new numbering first, then drop stale
    // files beyond the new range (id N kept its file name when unchanged,
    // so only delete what no longer belongs).
    const newIds = new Set(renumbered.map(e => e.id));
    for (const e of renumbered) {
      writeFileSync(join(eventsDir, `${e.id}.json`), JSON.stringify(e, null, 2));
    }
    for (const file of readdirSync(eventsDir).filter(f => f.endsWith('.json'))) {
      if (!newIds.has(file.replace('.json', ''))) {
        try { unlinkSync(join(eventsDir, file)); } catch { /* best-effort */ }
      }
    }

    return {
      success: true,
      output: `Compacted: ${events.length} → ${renumbered.length} events (merged ${merged}, parents remapped). Snapshot: .nwt/${SNAPSHOT_DIR}/`,
    };
  }

  /** Copy every event file into .nwt/snapshots/<stamp>/ before a destructive rewrite. */
  private snapshotEvents(nwtDir: string, eventsDir: string): void {
    try {
      if (!existsSync(eventsDir)) return;
      const snapDir = join(nwtDir, SNAPSHOT_DIR, `compact-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      mkdirSync(snapDir, { recursive: true });
      for (const f of readdirSync(eventsDir).filter(f => f.endsWith('.json'))) {
        try { copyFileSync(join(eventsDir, f), join(snapDir, f)); } catch { /* best-effort */ }
      }
      // Keep only the newest MAX_SNAPSHOTS snapshots.
      const snapRoot = join(nwtDir, SNAPSHOT_DIR);
      const dirs = readdirSync(snapRoot).sort();
      while (dirs.length > MAX_SNAPSHOTS) {
        const oldest = dirs.shift()!;
        try { rmSync(join(snapRoot, oldest), { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    } catch { /* best-effort — snapshotting must never break the caller */ }
  }

  // ── Archive ───────────────────────────────────────────

  /**
   * Move events older than ARCHIVE_AFTER_DAYS out of events/ into the
   * monthly archive. v0.2.0 parity fix: the aggregate archive file is
   * APPENDED to (a second archive run on the same day used to overwrite
   * the first one and lose those events).
   */
  private archive(cwd: string): ToolResult {
    const nwtDir = join(cwd, NWT_DIR);
    const eventsDir = join(nwtDir, EVENTS_DIR);
    const archiveDir = join(nwtDir, ARCHIVE_DIR);

    if (!existsSync(eventsDir)) {
      return { success: true, output: 'No events to archive.' };
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ARCHIVE_AFTER_DAYS);

    const files = readdirSync(eventsDir).filter(f => f.endsWith('.json')).sort();
    const toArchive: TimelineEvent[] = [];
    const toArchiveFiles: string[] = [];
    let kept = 0;

    for (const file of files) {
      try {
        const event = JSON.parse(readFileSync(join(eventsDir, file), 'utf-8'));
        if (new Date(event.timestamp) < cutoff) {
          toArchive.push(event);
          toArchiveFiles.push(file);
        } else {
          kept++;
        }
      } catch {
        kept++; // corrupted file — keep in place rather than destroy it
      }
    }

    if (toArchive.length === 0) {
      return { success: true, output: 'No events old enough to archive.' };
    }

    if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });

    // Append to the same-day aggregate (never overwrite).
    const archiveName = `archive-${new Date().toISOString().split('T')[0]}.json`;
    const archivePath = join(archiveDir, archiveName);
    let aggregate: TimelineEvent[] = [];
    if (existsSync(archivePath)) {
      try { aggregate = JSON.parse(readFileSync(archivePath, 'utf-8')); } catch { aggregate = []; }
      if (!Array.isArray(aggregate)) aggregate = [];
    }
    aggregate.push(...toArchive);
    writeFileSync(archivePath, JSON.stringify(aggregate, null, 2));

    // Keep a per-event copy alongside the aggregate, then drop the original.
    for (const file of toArchiveFiles) {
      try { renameSync(join(eventsDir, file), join(archiveDir, file)); } catch {}
    }

    return {
      success: true,
      output: `Archived ${toArchive.length} events to archives/${archiveName}. ${kept} events remain.`,
    };
  }

  // ── Auto Archive ──────────────────────────────────────

  /**
   * v0.2.0 parity: init/log now share ONE archive implementation (the old
   * duplicate grew a divergent overwrite behavior — same-day auto-archive
   * and manual archive could clobber each other's aggregate file).
   */
  private autoArchiveIfNeeded(cwd: string): void {
    try {
      this.archive(cwd);
    } catch {
      // Silent fail - don't break init
    }
  }

  // ── Helpers ───────────────────────────────────────────

  private loadEvents(cwd: string): TimelineEvent[] {
    const eventsDir = join(cwd, NWT_DIR, EVENTS_DIR);
    if (!existsSync(eventsDir)) return [];

    const files = readdirSync(eventsDir).filter(f => f.endsWith('.json')).sort();
    const events: TimelineEvent[] = [];

    for (const file of files) {
      try {
        const ev = JSON.parse(readFileSync(join(eventsDir, file), 'utf-8'));
        // Shape guard: a structurally invalid event file (e.g. `{}`) must be
        // skipped, not crash every read action that touches it.
        if (ev && typeof ev.id === 'string' && typeof ev.timestamp === 'string' && typeof ev.task === 'string') {
          events.push(ev);
        }
      } catch {
        // Skip corrupted files
      }
    }

    return events;
  }
}

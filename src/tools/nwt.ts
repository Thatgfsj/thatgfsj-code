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
  readdirSync, renameSync, unlinkSync
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
const MAX_EVENTS = 500;
const ARCHIVE_AFTER_DAYS = 30;

export class NwtTool implements Tool {
  name = 'nwt';
  description = `NeuroWeave Timeline - Project evolution memory.
Actions: init, log, history, search, story, explain, archive, diff, compact

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
    { name: 'query', type: 'string', description: 'Search query', required: false },
    { name: 'limit', type: 'number', description: 'Max results', required: false },
    { name: 'from_id', type: 'string', description: 'Start event ID for diff', required: false },
    { name: 'to_id', type: 'string', description: 'End event ID for diff', required: false },
  ];

  async execute(params: Record<string, any>, ctx?: any): Promise<ToolResult> {
    const cwd = ctx?.workingDirectory || process.cwd();
    const action = params.action;

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
    const eventsDir = join(nwtDir, EVENTS_DIR);
    const existing = existsSync(eventsDir)
      ? readdirSync(eventsDir).filter(f => f.endsWith('.json'))
      : [];
    const nextId = (existing.length + 1).toString().padStart(6, '0');

    // Get parent (last event)
    const parent = existing.length > 0
      ? existing.sort().pop()?.replace('.json', '')
      : undefined;

    // Validate importance
    const validImportance = ['low', 'normal', 'high', 'milestone'];
    const eventImportance = validImportance.includes(importance) ? importance : 'normal';

    const event: TimelineEvent = {
      id: nextId,
      timestamp: new Date().toISOString(),
      task: task.trim(),
      summary: summary.trim(),
      reason: reason?.trim() || undefined,
      files: files ? files.split(',').map((f: string) => f.trim()).filter(Boolean) : [],
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

    // Get events between from and to
    const fromIdx = events.indexOf(fromEvent);
    const toIdx = events.indexOf(toEvent);
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

    // Group consecutive events with same tags
    const groups: TimelineEvent[][] = [];
    let currentGroup: TimelineEvent[] = [events[0]];

    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const curr = events[i];

      // Same tags and close in time (within 1 hour)
      const sameTags = curr.tags.join(',') === prev.tags.join(',');
      const timeDiff = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
      const closeInTime = timeDiff < 3600000; // 1 hour

      if (sameTags && closeInTime) {
        currentGroup.push(curr);
      } else {
        groups.push(currentGroup);
        currentGroup = [curr];
      }
    }
    groups.push(currentGroup);

    // Merge groups with 3+ events
    let merged = 0;
    const newEvents: TimelineEvent[] = [];

    for (const group of groups) {
      if (group.length >= 3) {
        // Merge into one summary event
        const first = group[0];
        const last = group[group.length - 1];
        const allFiles = [...new Set(group.flatMap(e => e.files))];
        const allTags = [...new Set(group.flatMap(e => e.tags))];

        newEvents.push({
          id: first.id,
          timestamp: first.timestamp,
          task: `${first.task} ... ${last.task}`,
          summary: `Compacted ${group.length} events: ${group.map(e => e.task).join(', ')}`,
          files: allFiles,
          tags: allTags,
          importance: first.importance,
        });
        merged += group.length - 1;
      } else {
        newEvents.push(...group);
      }
    }

    if (merged === 0) {
      return { success: true, output: 'No events to compact.' };
    }

    // Re-write events
    for (const file of readdirSync(eventsDir).filter(f => f.endsWith('.json'))) {
      unlinkSync(join(eventsDir, file));
    }

    for (let i = 0; i < newEvents.length; i++) {
      const event = newEvents[i];
      event.id = (i + 1).toString().padStart(6, '0');
      writeFileSync(join(eventsDir, `${event.id}.json`), JSON.stringify(event, null, 2));
    }

    return {
      success: true,
      output: `Compacted: ${events.length} → ${newEvents.length} events (merged ${merged})`,
    };
  }

  // ── Archive ───────────────────────────────────────────

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
    const toArchive: string[] = [];
    const toKeep: string[] = [];

    for (const file of files) {
      try {
        const event = JSON.parse(readFileSync(join(eventsDir, file), 'utf-8'));
        const eventDate = new Date(event.timestamp);
        if (eventDate < cutoff) {
          toArchive.push(file);
        } else {
          toKeep.push(file);
        }
      } catch {
        toKeep.push(file);
      }
    }

    if (toArchive.length === 0) {
      return { success: true, output: 'No events old enough to archive.' };
    }

    // Create archive file
    const archiveName = `archive-${new Date().toISOString().split('T')[0]}.json`;
    const archiveEvents = toArchive.map(f => {
      return JSON.parse(readFileSync(join(eventsDir, f), 'utf-8'));
    });

    writeFileSync(
      join(archiveDir, archiveName),
      JSON.stringify(archiveEvents, null, 2)
    );

    // Remove archived events from events dir
    for (const file of toArchive) {
      const src = join(eventsDir, file);
      try { renameSync(src, join(archiveDir, file)); } catch {}
    }

    return {
      success: true,
      output: `Archived ${toArchive.length} events to archives/${archiveName}. ${toKeep.length} events remain.`,
    };
  }

  // ── Auto Archive ──────────────────────────────────────

  private autoArchiveIfNeeded(cwd: string): void {
    try {
      const nwtDir = join(cwd, NWT_DIR);
      const eventsDir = join(nwtDir, EVENTS_DIR);
      const archiveDir = join(nwtDir, ARCHIVE_DIR);

      if (!existsSync(eventsDir)) return;

      const files = readdirSync(eventsDir).filter(f => f.endsWith('.json'));
      if (files.length === 0) return;

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - ARCHIVE_AFTER_DAYS);

      const toArchive: string[] = [];
      const toKeep: string[] = [];

      for (const file of files) {
        try {
          const event = JSON.parse(readFileSync(join(eventsDir, file), 'utf-8'));
          const eventDate = new Date(event.timestamp);
          if (eventDate < cutoff) {
            toArchive.push(file);
          } else {
            toKeep.push(file);
          }
        } catch {
          toKeep.push(file);
        }
      }

      if (toArchive.length === 0) return;

      // Create monthly archive file
      const archiveName = `archive-${new Date().toISOString().split('T')[0]}.json`;
      const archiveEvents = toArchive.map(f => {
        return JSON.parse(readFileSync(join(eventsDir, f), 'utf-8'));
      });

      if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });

      // Append to existing archive or create new
      const archivePath = join(archiveDir, archiveName);
      let existing: any[] = [];
      if (existsSync(archivePath)) {
        try { existing = JSON.parse(readFileSync(archivePath, 'utf-8')); } catch {}
      }
      existing.push(...archiveEvents);
      writeFileSync(archivePath, JSON.stringify(existing, null, 2));

      // Remove archived files from events dir
      for (const file of toArchive) {
        try { renameSync(join(eventsDir, file), join(archiveDir, file)); } catch {}
      }
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
        events.push(JSON.parse(readFileSync(join(eventsDir, file), 'utf-8')));
      } catch {
        // Skip corrupted files
      }
    }

    return events;
  }
}

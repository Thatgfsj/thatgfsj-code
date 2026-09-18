/**
 * Session Manager - Manages conversation history with auto-compaction
 *
 * v3.0.5 additions:
 *   - Disk persistence: every completed round can be persisted to
 *     ~/.thatgfsj/sessions/<id>.json, and /resume restores a previous
 *     session. Files are validated on load (dangling tool_calls are
 *     stripped) so a restored history can never produce a provider 400.
 *   - reset(): starts a fresh conversation while KEEPING the system prompt
 *     (the old clear() dropped it, leaving every later request unprompted).
 *   - autoCompact: when history exceeds maxMessages it is compacted once
 *     (atomic tool groups, see compactor.ts) instead of being silently
 *     truncated every round. The TUI is notified via onAutoCompact.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ChatMessage } from '../types.js';
import { ContextCompactor } from './compactor.js';

/**
 * v2.2.4 (port from v2.1.0): patterns that, if found in an assistant
 * message, indicate the message is a truncated/aborted response that
 * should NOT be persisted into history. Without this filter, the next
 * turn's LLM sees the marker and starts echoing it back, creating a
 * self-reinforcing "[已中断]" hallucination loop.
 *
 * Two-tier check:
 *   1. STRONG markers — unambiguous pollution, always drop.
 *   2. WEAK markers — only drop if the message is also short (<200 chars),
 *      doesn't end with '?' and has no temporal references.
 */
const POLLUTION_STRONG: RegExp[] = [
  /\[已中断\]/,
  /\[interrupted\]/i,
];

const POLLUTION_WEAK: RegExp[] = [
  /^\s*[\*#>\-`]*\s*\[已中断\]/m,
  /^\s*[\*#>\-`]*\s*\[interrupted\]/im,
  /\bresponse (was )?(truncated|cut off|interrupted)\b/i,
  /\boutput (was )?(truncated|cut off|interrupted)\b/i,
];

function looksPolluted(content: string): boolean {
  if (!content) return false;
  if (POLLUTION_STRONG.some(p => p.test(content))) return true;
  if (content.length >= 200) return false;
  if (/\?\s*$/.test(content.trim())) return false;
  if (/\b(last time|earlier|before|previously|yesterday)\b/i.test(content)) return false;
  if (POLLUTION_WEAK.some(p => p.test(content))) return true;
  return false;
}

// ==================== Persistence ====================

export interface SessionFile {
  version: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  provider?: string;
  model?: string;
  messages: ChatMessage[];
}

export interface SessionSummary {
  id: string;
  updatedAt: Date;
  messageCount: number;
  /** First user message, trimmed — the human-readable "what was this about". */
  preview: string;
}

export function sessionsDir(): string {
  return join(homedir(), '.thatgfsj', 'sessions');
}

/**
 * v3.0.5: shared load-time sanitizer. A restored history must never carry a
 * tool_calls block without its results, or the next provider request 400s:
 * - drop orphaned 'tool' messages (no preceding assistant tool_calls)
 * - strip tool_calls from an assistant message whose results were lost
 */
export function sanitizeLoadedMessages(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let pendingCalls = 0;
  for (const m of messages) {
    if (m.role === 'tool') {
      if (pendingCalls > 0) {
        out.push(m);
        pendingCalls--;
      }
      // else: orphaned tool result — drop
      continue;
    }
    if (pendingCalls > 0) {
      // A new non-tool message arrived before results completed: the
      // previous assistant's tool_calls have no results — strip them.
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].role === 'assistant' && out[i].tool_calls) {
          const fixed: ChatMessage = { ...out[i] };
          delete fixed.tool_calls;
          fixed.content = fixed.content || '(tool calls dropped: results missing)';
          out[i] = fixed;
          break;
        }
      }
      pendingCalls = 0;
    }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      pendingCalls = m.tool_calls.length;
    }
    out.push(m);
  }
  // Trailing dangling calls (crash mid-loop) — strip them too.
  if (pendingCalls > 0) {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].role === 'assistant' && out[i].tool_calls) {
        const fixed: ChatMessage = { ...out[i] };
        delete fixed.tool_calls;
        fixed.content = fixed.content || '(tool calls dropped: results missing)';
        out[i] = fixed;
        break;
      }
    }
  }
  return out;
}

export class SessionManager {
  private messages: ChatMessage[] = [];
  private sessionId: string;
  private createdAt: Date;
  private compactor: ContextCompactor;
  private maxMessages: number;
  private droppedCount: number = 0;
  /** Whether history was compacted and the new-context toast not yet surfaced. */
  private lastCompaction: { before: number; after: number } | null = null;
  /** Extra metadata recorded in the session file. */
  public meta?: { provider?: string; model?: string };
  /**
   * Called after history exceeded maxMessages and was compacted once.
   * The TUI surfaces a toast; nobody is required to act.
   */
  public onAutoCompact?: (info: { before: number; after: number }) => void;

  constructor(maxMessages = 50, options?: { onAutoCompact?: SessionManager['onAutoCompact'] }) {
    this.maxMessages = maxMessages;
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.createdAt = new Date();
    this.compactor = new ContextCompactor({ maxMessages });
    this.onAutoCompact = options?.onAutoCompact;
  }

  addMessage(role: ChatMessage['role'], content: string, extras?: Partial<ChatMessage>): void {
    this.messages.push({ role, content, ...extras });
    this.autoCompact();
  }

  /**
   * Same as addMessage but returns false (and skips the push) if the message
   * content matches a known truncation/abort pollution pattern.
   */
  addMessageSafe(role: ChatMessage['role'], content: string, extras?: Partial<ChatMessage>): boolean {
    if (role === 'assistant' && looksPolluted(typeof content === 'string' ? content : JSON.stringify(content))) {
      this.droppedCount++;
      return false;
    }
    this.addMessage(role, content, extras);
    return true;
  }

  /** Total messages dropped by addMessageSafe since session start. */
  getDroppedCount(): number {
    return this.droppedCount;
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  /**
   * v3.0.5: fresh conversation that KEEPS the system prompt. The previous
   * clear() removed it, so every later request ran without the identity /
   * tool / skills instructions until the process restarted.
   */
  reset(): void {
    const system = this.messages.find(m => m.role === 'system');
    this.messages = system ? [system] : [];
    this.lastCompaction = null;
    // v3.0.5 fix: fresh id so the next persist() writes a NEW session file
    // instead of overwriting the old conversation (which would make it
    // unrestorable via /resume).
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.createdAt = new Date();
  }

  /**
   * v3.0.5: replace in-memory history (used by /resume). Input is sanitized
   * so a malformed file can not poison the next request.
   */
  restore(messages: ChatMessage[], meta?: { id?: string; createdAt?: string; provider?: string; model?: string }): void {
    this.messages = sanitizeLoadedMessages(messages);
    if (meta?.id) this.sessionId = meta.id;
    if (meta?.createdAt) {
      const d = new Date(meta.createdAt);
      if (!isNaN(d.getTime())) this.createdAt = d;
    }
    if (meta?.provider || meta?.model) {
      this.meta = { provider: meta.provider, model: meta.model };
    }
    this.lastCompaction = null;
  }

  clear(): void {
    this.messages = [];
  }

  /**
   * v3.0.5: replace the (first) system prompt in place — used when tools or
   * the permission mode change and the prompt must be rebuilt without
   * resetting the conversation.
   */
  replaceSystemMessage(content: string): void {
    const idx = this.messages.findIndex(m => m.role === 'system');
    if (idx >= 0) {
      this.messages[idx] = { ...this.messages[idx], content };
    } else {
      this.messages.unshift({ role: 'system', content });
    }
  }

  /**
   * Compact when over the limit — once per crossing, atomic groups (v3.0.5).
   * The previous design only suggested /new and never touched history, which
   * let sessions grow unbounded (and the /compact path silently rewrote
   * history every round). Now: compact at the threshold, notify once.
   */
  private autoCompact(): void {
    if (this.messages.length <= this.maxMessages) return;

    const { compacted } = this.compactor.compact(this.messages);
    if (compacted.length >= this.messages.length) return; // nothing removable

    const before = this.messages.length;
    this.messages = compacted;
    this.lastCompaction = { before, after: compacted.length };
    try {
      this.onAutoCompact?.(this.lastCompaction);
    } catch {
      // Callback failure must not break the chat loop.
    }
  }

  /** v3.0.5: explicit compaction (the /compact command). */
  compactNow(): { before: number; after: number } | null {
    const { compacted, result } = this.compactor.compact(this.messages);
    if (result.removedCount <= 0) return null;
    const before = this.messages.length;
    this.messages = compacted;
    return { before, after: compacted.length };
  }

  truncate(maxMessages?: number): void {
    if (maxMessages) {
      this.maxMessages = maxMessages;
      this.compactor = new ContextCompactor({ maxMessages });
    }
    const { compacted } = this.compactor.compact(this.messages);
    this.messages = compacted;
  }

  getId(): string {
    return this.sessionId;
  }

  getInfo(): { id: string; messageCount: number; createdAt: Date } {
    return {
      id: this.sessionId,
      messageCount: this.messages.length,
      createdAt: this.createdAt,
    };
  }

  // ==================== Persistence (v3.0.5) ====================

  /**
   * Write the current history to ~/.thatgfsj/sessions/<id>.json and prune
   * old sessions. Fire-and-forget friendly: errors are swallowed by the
   * caller — a full disk must never kill a chat round.
   */
  persist(): void {
    try {
      const dir = sessionsDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const file: SessionFile = {
        version: 1,
        id: this.sessionId,
        createdAt: this.createdAt.toISOString(),
        updatedAt: new Date().toISOString(),
        provider: this.meta?.provider,
        model: this.meta?.model,
        messages: this.messages,
      };
      writeFileSync(join(dir, `${this.sessionId}.json`), JSON.stringify(file, null, 2), 'utf-8');
      pruneSessions(20);
    } catch {
      // best-effort
    }
  }

  /**
   * Restore a previously persisted session into THIS manager (in place).
   */
  loadFrom(file: SessionFile): void {
    this.restore(file.messages || [], {
      id: file.id,
      createdAt: file.createdAt,
      provider: file.provider,
      model: file.model,
    });
  }

  /** List the most recent persisted sessions, newest first. */
  static list(limit = 10): SessionSummary[] {
    const dir = sessionsDir();
    if (!existsSync(dir)) return [];
    try {
      const files = readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const full = join(dir, f);
          try {
            return { full, mtime: statSync(full).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((x): x is { full: string; mtime: number } => x !== null)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);

      const out: SessionSummary[] = [];
      for (const f of files) {
        try {
          const data = JSON.parse(readFileSync(f.full, 'utf-8')) as SessionFile;
          const firstUser = (data.messages || []).find(m => m.role === 'user' && typeof m.content === 'string');
          out.push({
            id: data.id,
            updatedAt: new Date(data.updatedAt || data.createdAt || Date.now()),
            messageCount: (data.messages || []).length,
            preview: firstUser ? (firstUser.content as string).slice(0, 60).replace(/\s+/g, ' ') : '(no user messages)',
          });
        } catch {
          // skip corrupted file
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  /** Load a persisted session file by id (or filename). */
  static load(id: string): SessionFile | null {
    const dir = sessionsDir();
    const filename = id.endsWith('.json') ? id : `${id}.json`;
    const full = join(dir, filename);
    if (!existsSync(full)) return null;
    try {
      const data = JSON.parse(readFileSync(full, 'utf-8')) as SessionFile;
      if (!data || !Array.isArray(data.messages)) return null;
      return data;
    } catch {
      return null;
    }
  }
}

/** Keep only the newest `keep` session files. */
function pruneSessions(keep: number): void {
  const dir = sessionsDir();
  if (!existsSync(dir)) return;
  try {
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const full = join(dir, f);
        try {
          return { full, mtime: statSync(full).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((x): x is { full: string; mtime: number } => x !== null)
      .sort((a, b) => b.mtime - a.mtime);

    for (const f of files.slice(keep)) {
      try { unlinkSync(f.full); } catch { /* best-effort */ }
    }
  } catch {
    // best-effort
  }
}

export { ContextCompactor } from './compactor.js';
export type { CompactorConfig, CompressionResult } from './compactor.js';
export * from './message.js';

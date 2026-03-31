/**
 * S11: State & Session Management
 * 
 * Three layers:
 * 1. EphemeralState  - in-memory, current session only
 * 2. PersistentState - survives restarts (file-based)
 * 3. SessionState    - per-conversation state
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * S11: Ephemeral State — in-memory key-value store
 */
export class EphemeralState<T = any> {
  private data: Map<string, T> = new Map();

  get(key: string): T | undefined { return this.data.get(key); }
  set(key: string, value: T): void { this.data.set(key, value); }
  has(key: string): boolean { return this.data.has(key); }
  delete(key: string): void { this.data.delete(key); }
  clear(): void { this.data.clear(); }
  keys(): string[] { return [...this.data.keys()]; }
  entries(): [string, T][] { return [...this.data.entries()]; }
}

/**
 * S11: Persistent State — file-backed key-value store
 */
export class PersistentState<T = any> {
  private filePath: string;
  private data: Record<string, T> = {};

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        this.data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      }
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error: any) {
      console.error('[State] Failed to save:', error.message);
    }
  }

  get(key: string): T | undefined { return this.data[key]; }
  set(key: string, value: T): void { this.data[key] = value; this.save(); }
  has(key: string): boolean { return key in this.data; }
  delete(key: string): void { delete this.data[key]; this.save(); }
  clear(): void { this.data = {}; this.save(); }
  keys(): string[] { return Object.keys(this.data); }
}

/**
 * S11: Session State — per-conversation state
 */
export class SessionState<T = any> {
  private sessions: Map<string, EphemeralState<T>> = new Map();
  private currentSessionId: string | null = null;

  createSession(sessionId: string): void {
    this.sessions.set(sessionId, new EphemeralState<T>());
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  setCurrentSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      this.createSession(sessionId);
    }
    this.currentSessionId = sessionId;
  }

  getCurrentSession(): EphemeralState<T> | null {
    if (!this.currentSessionId) return null;
    return this.sessions.get(this.currentSessionId) || null;
  }

  getSession(sessionId: string): EphemeralState<T> | null {
    return this.sessions.get(sessionId) || null;
  }
}

/**
 * S11: Global State Manager
 */
export class StateManager {
  ephemeral: EphemeralState;
  persistent: PersistentState;
  session: SessionState;

  constructor(dataDir: string = join(process.cwd(), '.thatgfsj', 'state')) {
    this.ephemeral = new EphemeralState();
    this.persistent = new PersistentState(join(dataDir, 'persistent.json'));
    this.session = new SessionState();
  }
}

let globalStateManager: StateManager | null = null;

export function getStateManager(): StateManager {
  if (!globalStateManager) {
    globalStateManager = new StateManager();
  }
  return globalStateManager;
}

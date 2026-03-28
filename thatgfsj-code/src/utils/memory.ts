/**
 * Session Memory - Remember modifications during conversation
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

export interface MemoryEntry {
  id: string;
  timestamp: number;
  type: 'file_read' | 'file_write' | 'file_edit' | 'command' | 'git' | 'note';
  description: string;
  details: Record<string, any>;
}

export class SessionMemory {
  private entries: MemoryEntry[] = [];
  private sessionId: string;
  private memoryFile?: string;

  constructor(sessionId?: string) {
    this.sessionId = sessionId || this.generateId();
  }

  /**
   * Add an entry to memory
   */
  add(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): void {
    this.entries.push({
      ...entry,
      id: this.generateId(),
      timestamp: Date.now()
    });
  }

  /**
   * Record file read
   */
  recordRead(path: string, lines?: number): void {
    this.add({
      type: 'file_read',
      description: `Read ${path}`,
      details: { path, lines }
    });
  }

  /**
   * Record file write
   */
  recordWrite(path: string, content?: string): void {
    this.add({
      type: 'file_write',
      description: `Wrote ${path}`,
      details: { path, size: content?.length || 0 }
    });
  }

  /**
   * Record file edit
   */
  recordEdit(path: string, operation: string): void {
    this.add({
      type: 'file_edit',
      description: `Edited ${path}: ${operation}`,
      details: { path, operation }
    });
  }

  /**
   * Record command execution
   */
  recordCommand(command: string, output?: string): void {
    this.add({
      type: 'command',
      description: `Executed: ${command}`,
      details: { command, output: output?.slice(0, 200) }
    });
  }

  /**
   * Record git operation
   */
  recordGit(operation: string, result: string): void {
    this.add({
      type: 'git',
      description: `Git ${operation}`,
      details: { operation, result: result.slice(0, 200) }
    });
  }

  /**
   * Record a note
   */
  recordNote(note: string): void {
    this.add({
      type: 'note',
      description: note,
      details: {}
    });
  }

  /**
   * Get all entries
   */
  getEntries(): MemoryEntry[] {
    return [...this.entries];
  }

  /**
   * Get recent entries
   */
  getRecent(count: number = 10): MemoryEntry[] {
    return this.entries.slice(-count);
  }

  /**
   * Get entries by type
   */
  getByType(type: MemoryEntry['type']): MemoryEntry[] {
    return this.entries.filter(e => e.type === type);
  }

  /**
   * Search entries
   */
  search(query: string): MemoryEntry[] {
    const lower = query.toLowerCase();
    return this.entries.filter(e => 
      e.description.toLowerCase().includes(lower) ||
      JSON.stringify(e.details).toLowerCase().includes(lower)
    );
  }

  /**
   * Get summary
   */
  getSummary(): string {
    if (this.entries.length === 0) {
      return 'No actions recorded yet.';
    }

    const types = this.entries.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const lines = ['📋 Session Summary:'];
    
    for (const [type, count] of Object.entries(types)) {
      const emoji = {
        'file_read': '📖',
        'file_write': '✍️',
        'file_edit': '📝',
        'command': '⚡',
        'git': '📊',
        'note': '📌'
      }[type] || '•';
      
      lines.push(`  ${emoji} ${type}: ${count}`);
    }

    return lines.join('\n');
  }

  /**
   * Export to file
   */
  save(): void {
    if (!this.memoryFile) {
      const homeDir = homedir();
      const memDir = join(homeDir, '.thatgfsj', 'memory');
      
      if (!existsSync(memDir)) {
        mkdirSync(memDir, { recursive: true });
      }
      
      this.memoryFile = join(memDir, `${this.sessionId}.json`);
    }

    writeFileSync(this.memoryFile, JSON.stringify({
      sessionId: this.sessionId,
      entries: this.entries,
      savedAt: Date.now()
    }, null, 2));
  }

  /**
   * Load from file
   */
  load(sessionId: string): boolean {
    const homeDir = homedir();
    const memoryFile = join(homeDir, '.thatgfsj', 'memory', `${sessionId}.json`);
    
    if (!existsSync(memoryFile)) {
      return false;
    }

    try {
      const data = JSON.parse(readFileSync(memoryFile, 'utf-8'));
      this.entries = data.entries || [];
      this.sessionId = data.sessionId;
      this.memoryFile = memoryFile;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear memory
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

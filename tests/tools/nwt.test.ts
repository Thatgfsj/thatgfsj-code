import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { NwtTool } from '../../src/tools/nwt.js';

let tmp: string;
const tool = new NwtTool();
const ctx = () => ({ workingDirectory: tmp });

const eventPath = (id: string) => join(tmp, '.nwt', 'events', `${id}.json`);

function seedEvent(id: string, opts: Partial<{
  timestamp: string; task: string; tags: string[]; parent: string;
  files: string[]; reason: string; importance: string;
}> = {}) {
  const ev = {
    id,
    timestamp: opts.timestamp ?? new Date().toISOString(),
    task: opts.task ?? `task ${id}`,
    summary: `summary ${id}`,
    files: opts.files ?? [],
    tags: opts.tags ?? ['fix'],
    ...(opts.parent ? { parent: opts.parent } : {}),
    ...(opts.reason ? { reason: opts.reason } : {}),
    importance: opts.importance ?? 'normal',
  };
  writeFileSync(eventPath(id), JSON.stringify(ev, null, 2), 'utf-8');
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 3600_000).toISOString();

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gfcode-nwt-'));
  mkdirSync(join(tmp, '.nwt', 'events'), { recursive: true });
});

afterAll(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('nwt log (v0.2.0 auto-chaining parity)', () => {
  it('chains to the latest event by numeric id, not filename sort', async () => {
    seedEvent('000002', { timestamp: minutesAgo(1) });
    // A non-numeric file that would sort LAST alphabetically in the old code
    writeFileSync(join(tmp, '.nwt', 'events', 'zzz.json'), '{}', 'utf-8');
    const r = await tool.execute({ action: 'log', task: 't', summary: 's' }, ctx());
    expect(r.success).toBe(true);
    const ev = JSON.parse(readFileSync(eventPath('000003'), 'utf-8'));
    expect(ev.parent).toBe('000002');
  });

  it('parent="none" starts an explicit branch', async () => {
    const r = await tool.execute({ action: 'log', task: 'branch', summary: 's', parent: 'none' }, ctx());
    expect(r.success).toBe(true);
    const files = readdirSync(join(tmp, '.nwt', 'events')).filter(f => f.endsWith('.json')).sort();
    const last = files[files.length - 1];
    const ev = JSON.parse(readFileSync(join(tmp, '.nwt', 'events', last), 'utf-8'));
    expect(ev.parent).toBeUndefined();
  });

  it('parent="<id>" validates and attaches', async () => {
    const ok = await tool.execute({ action: 'log', task: 'x', summary: 's', parent: '2' }, ctx());
    expect(ok.success).toBe(true);
    const bad = await tool.execute({ action: 'log', task: 'x', summary: 's', parent: '9999' }, ctx());
    expect(bad.success).toBe(false);
    expect(bad.error).toContain('parent="none"');
  });

  it('normalizes file paths to POSIX on save', async () => {
    const r = await tool.execute({ action: 'log', task: 'p', summary: 's', files: 'src\\a.ts, src/b.ts' }, ctx());
    expect(r.success).toBe(true);
    const numeric = readdirSync(join(tmp, '.nwt', 'events'))
      .filter(f => f.endsWith('.json') && /^\d{6}\.json$/.test(f))
      .sort();
    const ev = JSON.parse(readFileSync(join(tmp, '.nwt', 'events', numeric[numeric.length - 1]), 'utf-8'));
    expect(ev.files).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('nwt compact (v0.2.0 corruption-fix parity)', () => {
  it('merges same-tag chains, remaps parents, keeps reason, writes a snapshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gfcode-nwt-compact-'));
    mkdirSync(join(dir, '.nwt', 'events'), { recursive: true });
    const t = new NwtTool();
    const c = { workingDirectory: dir };
    const ep = (id: string) => join(dir, '.nwt', 'events', `${id}.json`);
    const seed = (id: string, o: any = {}) => writeFileSync(ep(id), JSON.stringify({
      id, timestamp: o.timestamp ?? minutesAgo(60 - Number(id)),
      task: o.task ?? `t${id}`, summary: `s${id}`,
      reason: o.reason, files: [], tags: o.tags ?? ['chore'],
      ...(o.parent ? { parent: o.parent } : {}),
      importance: o.importance ?? 'normal',
    }, null, 2), 'utf-8');

    // chain 1: 6 same-tag events within 1h → merged into 1
    seed('000001', { parent: undefined, reason: 'root cause' });
    seed('000002', { parent: '000001' });
    seed('000003', { parent: '000002' });
    seed('000004', { parent: '000003' });
    seed('000005', { parent: '000004' });
    seed('000006', { parent: '000005' });
    // chain 2: different tag → survives untouched
    seed('000007', { tags: ['docs'], parent: '000006' });
    seed('000008', { tags: ['docs'], parent: '000007' });
    // chain 3: another mergeable chain, child of a merged-away member
    seed('000009', { parent: '000004', tags: ['perf'] });
    seed('000010', { parent: '000009', tags: ['perf'] });
    seed('000011', { parent: '000010', tags: ['perf'] });
    seed('000012', { parent: '000011', tags: ['perf'] });

    const r = await t.execute({ action: 'compact' }, c);
    expect(r.success).toBe(true);
    expect(r.output).toContain('parents remapped');

    // 12 → 1 (merged chain 1) + 2 (docs) + 1 (merged perf chain) = 4 events
    const remaining = readdirSync(join(dir, '.nwt', 'events')).filter(f => f.endsWith('.json'));
    expect(remaining.length).toBe(4);

    // merged event keeps the first's reason; parents remapped into new numbering
    const ev1 = JSON.parse(readFileSync(ep('000001'), 'utf-8'));
    expect(ev1.task).toContain('t000001');
    expect(ev1.reason).toBe('root cause');
    // docs chain survives: old 000007→new 000002 (parent old 000006 merged → 000001),
    // old 000008→new 000003 (parent → 000002)
    const docsHead = JSON.parse(readFileSync(ep('000002'), 'utf-8'));
    expect(docsHead.tags).toEqual(['docs']);
    expect(docsHead.parent).toBe('000001');
    const docsTail = JSON.parse(readFileSync(ep('000003'), 'utf-8'));
    expect(docsTail.parent).toBe('000002');
    // perf chain head (old 000009, child of merged-away 000004) → new 000004, parent → 000001
    const perfHead = JSON.parse(readFileSync(ep('000004'), 'utf-8'));
    expect(perfHead.tags).toEqual(['perf']);
    expect(perfHead.parent).toBe('000001');

    // snapshot written and holds all 12 original files
    const snapRoot = join(dir, '.nwt', 'snapshots');
    const snaps = readdirSync(snapRoot);
    expect(snaps.length).toBe(1);
    expect(readdirSync(join(snapRoot, snaps[0])).length).toBe(12);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to compact tiny stores', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gfcode-nwt-small-'));
    mkdirSync(join(dir, '.nwt', 'events'), { recursive: true });
    const t = new NwtTool();
    const r = await t.execute({ action: 'compact' }, { workingDirectory: dir });
    expect(r.success).toBe(true);
    expect(r.output).toContain('need 10+');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('nwt archive (same-day append parity)', () => {
  it('two archive runs on the same day never lose events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gfcode-nwt-arch-'));
    mkdirSync(join(dir, '.nwt', 'events'), { recursive: true });
    const t = new NwtTool();
    const c = { workingDirectory: dir };
    const ep = (id: string) => join(dir, '.nwt', 'events', `${id}.json`);
    // batch 1
    for (let i = 1; i <= 2; i++) {
      writeFileSync(ep(`00000${i}`), JSON.stringify({
        id: `00000${i}`, timestamp: daysAgo(40), task: `old${i}`, summary: 's',
        files: [], tags: [], importance: 'normal',
      }), 'utf-8');
    }
    const r1 = await t.execute({ action: 'archive' }, c);
    expect(r1.success).toBe(true);
    // batch 2 (still no fresh events — everything is 40 days old again? no:
    // first run moved them; seed a new old one for the second run)
    writeFileSync(ep('000003'), JSON.stringify({
      id: '000003', timestamp: daysAgo(40), task: 'old3', summary: 's',
      files: [], tags: [], importance: 'normal',
    }), 'utf-8');
    const r2 = await t.execute({ action: 'archive' }, c);
    expect(r2.success).toBe(true);

    const archiveDir = join(dir, '.nwt', 'archives');
    const aggregates = readdirSync(archiveDir).filter(f => f.startsWith('archive-') && f.endsWith('.json'));
    expect(aggregates.length).toBe(1);
    const agg = JSON.parse(readFileSync(join(archiveDir, aggregates[0]), 'utf-8'));
    expect(agg.map((e: any) => e.task).sort()).toEqual(['old1', 'old2', 'old3']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves corrupted event files in place instead of archiving them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gfcode-nwt-corrupt-'));
    mkdirSync(join(dir, '.nwt', 'events'), { recursive: true });
    const t = new NwtTool();
    const c = { workingDirectory: dir };
    writeFileSync(join(dir, '.nwt', 'events', '000001.json'), '{corrupt', 'utf-8');
    const r = await t.execute({ action: 'archive' }, c);
    expect(r.success).toBe(true);
    expect(existsSync(join(dir, '.nwt', 'events', '000001.json'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('nwt plan-mode gate (v3.1.0 readOnly)', () => {
  it('write actions are refused while readOnly; read actions pass', async () => {
    const ro = { workingDirectory: tmp, readOnly: () => true };
    const blocked = await tool.execute({ action: 'log', task: 't', summary: 's' }, ro);
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain('计划模式');
    const archived = await tool.execute({ action: 'archive' }, ro);
    expect(archived.success).toBe(false);
    // reads still work
    const hist = await tool.execute({ action: 'history' }, ro);
    expect(hist.success).toBe(true);
  });
});

describe('nwt diff (v0.2.0 reversed-range parity)', () => {
  it('returns a clean validation error for a reversed range', async () => {
    seedEvent('000021', { timestamp: minutesAgo(10) });
    seedEvent('000022', { timestamp: minutesAgo(5) });
    const r = await tool.execute({ action: 'diff', from_id: '22', to_id: '21' }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toContain('Reversed');
  });

  it('reports files added/removed between two events', async () => {
    seedEvent('000031', { timestamp: minutesAgo(10), files: ['a.ts', 'b.ts'] });
    seedEvent('000032', { timestamp: minutesAgo(5), files: ['a.ts', 'c.ts'] });
    const r = await tool.execute({ action: 'diff', from_id: '31', to_id: '32' }, ctx());
    expect(r.success).toBe(true);
    expect(r.output).toContain('Added: c.ts');
    expect(r.output).toContain('Removed: b.ts');
  });
});

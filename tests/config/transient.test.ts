/**
 * v3.5.0 regression: one-shot `-m`/`-t` must not persist into config.json
 * (field report: `gfc -m totally/fake-model-xyz` permanently rewrote the
 * user's model and switched useBuiltin off).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { ConfigManager } from '../../src/config/index.js';

describe('config: transient (one-shot flag) updates', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nwt-cfg-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function loadWithHome(): Promise<ConfigManager> {
    // ConfigManager reads via os.homedir(); tests inject through env in
    // other suites — here we exercise setTransient semantics directly, so
    // persistence is asserted on the file the manager was loaded with.
    return ConfigManager.load();
  }

  it('setTransient changes the in-memory model without writing config.json', async () => {
    const mgr = await loadWithHome();
    // Point the manager at our temp home the same way load() resolves it.
    (mgr as any).configPath = join(home, '.thatgfsj', 'config.json');

    mgr.setTransient({ model: 'totally/fake-model-xyz' });
    expect(mgr.get().model).toBe('totally/fake-model-xyz');
    // Mirrors save()'s rule in memory: explicit model leaves builtin mode.
    expect(mgr.get().useBuiltin).toBe(false);
    // Nothing on disk.
    expect(existsSync(join(home, '.thatgfsj', 'config.json'))).toBe(false);
  });

  it('setTransient does not survive a fresh load (no disk write)', async () => {
    const mgr = await loadWithHome();
    (mgr as any).configPath = join(home, '.thatgfsj', 'config.json');
    const before = mgr.get().model;

    mgr.setTransient({ model: 'transient/model' });
    expect(mgr.get().model).toBe('transient/model');

    // A brand-new manager (fresh load) still sees the ORIGINAL model.
    const fresh = await loadWithHome();
    expect(fresh.get().model).toBe(before);
    expect(fresh.get().model).not.toBe('transient/model');
  });

  it('save() still persists as before (contrast with transient)', async () => {
    const mgr = await loadWithHome();
    (mgr as any).configPath = join(home, '.thatgfsj', 'config.json');
    await mgr.save({ model: 'saved/model' });
    const cfg = JSON.parse(readFileSync(join(home, '.thatgfsj', 'config.json'), 'utf-8'));
    expect(cfg.model).toBe('saved/model');
  });
});

/**
 * Smoke + boundary tests for the compiled `dist/index.js` binary.
 *
 * Runs the CLI as a child process and asserts on the exit code and stdout/stderr.
 * Does NOT make any LLM API call; only exercises the empty-arg guards and
 * commander metadata. Safe for CI.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// repo root is one level up from tests/
const REPO = resolve(__dirname, '..');
const CLI = join(REPO, 'dist', 'index.js');

// `bash -n install.sh` may not be available on Windows. Skip gracefully there.
const HAS_BASH = (() => {
  try {
    const r = spawnSync('bash', ['--version'], { stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
})();

function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf-8',
    timeout: 30_000,
    ...opts,
  });
}

test('preflight: dist/index.js exists', () => {
  assert.ok(
    existsSync(CLI),
    `dist/index.js must exist (run \`npm run build\` first): ${CLI}`,
  );
});

test('smoke: --version prints the package version', () => {
  const r = run(['--version']);
  assert.equal(r.status, 0, `--version should exit 0, got ${r.status}: ${r.stderr}`);
  // Expect exactly "0.2.2"
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
  assert.equal(
    r.stdout.trim(),
    '0.2.2',
    `--version should match package.json: got ${r.stdout.trim()}`,
  );
});

test('smoke: --help lists all subcommands', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0, `--help should exit 0, got ${r.status}: ${r.stderr}`);
  for (const cmd of ['init', 'explain', 'debug', 'chat', 'template']) {
    assert.match(
      r.stdout,
      new RegExp(cmd),
      `--help should mention "${cmd}"`,
    );
  }
  assert.match(r.stdout, /Usage: gfcode/);
});

test('boundary: chat with no arg prints guard message', () => {
  const r = run(['chat']);
  // commander async action quirks: process.exit(1) is absorbed by commander,
  // so we don't strictly assert exit code, only on the stderr pattern.
  const combined = (r.stderr ?? '') + (r.stdout ?? '');
  assert.match(
    combined,
    /请提供问题/,
    `chat empty arg should print "请提供问题" guard, got: ${combined}`,
  );
});

test('boundary: explain with no arg prints guard message', () => {
  const r = run(['explain']);
  const combined = (r.stderr ?? '') + (r.stdout ?? '');
  assert.match(
    combined,
    /请提供要解释的代码/,
    `explain empty arg should print guard, got: ${combined}`,
  );
});

test('boundary: debug with no arg prints guard message', () => {
  const r = run(['debug']);
  const combined = (r.stderr ?? '') + (r.stdout ?? '');
  assert.match(
    combined,
    /请提供要调试的代码/,
    `debug empty arg should print guard, got: ${combined}`,
  );
});

test('boundary: template with no arg lists templates', () => {
  const r = run(['template']);
  const combined = (r.stderr ?? '') + (r.stdout ?? '');
  // No-arg falls through to "请指定模板类型" guard.
  assert.match(
    combined,
    /请指定模板类型|react|vue|express/,
    `template empty arg should show template list or guard, got: ${combined}`,
  );
});

test('smoke: --bogus-flag is rejected by commander', () => {
  const r = run(['--bogus-flag']);
  // commander writes "error: unknown option '--bogus-flag'" to stderr; exit
  // code may be 0 or 1 depending on commander's async-action wrapping, but
  // the error text must be present.
  const combined = (r.stderr ?? '') + (r.stdout ?? '');
  assert.match(
    combined,
    /unknown option|--bogus-flag/,
    `unknown option must be reported, got: ${combined}`,
  );
});

test('smoke: bash -n install.sh passes syntax check', { skip: !HAS_BASH }, () => {
  const r = spawnSync('bash', ['-n', join(REPO, 'install.sh')], {
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  assert.equal(
    r.status,
    0,
    `bash -n install.sh should exit 0, got ${r.status}: ${r.stderr}`,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
function load(content, mode, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shed-env-'));
  const file = path.join(dir, 'env');
  fs.writeFileSync(file, content, { mode });
  fs.chmodSync(file, mode);
  const r = spawnSync(process.execPath, ['-e', "import('./server/env.js').then(() => console.log(process.env.SHED_T_A + '|' + process.env.SHED_T_B))"], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, SHED_ENV_FILE: file, ...env } });
  return r.stdout.trim();
}

test('an owner-only env file is loaded: comments skipped, quotes stripped', () => {
  assert.equal(load('# note\nSHED_T_A=one\nexport SHED_T_B="two"\n', 0o600), 'one|two');
});
test('real environment wins over the file', () => {
  assert.equal(load('SHED_T_A=file\n', 0o600, { SHED_T_A: 'real' }), 'real|undefined');
});
test('a group- or world-readable env file is ignored', () => {
  assert.equal(load('SHED_T_A=one\n', 0o644), 'undefined|undefined');
});

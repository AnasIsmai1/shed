import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
function claudeState(zshLoggedIn, viaZsh) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'shed-health-'));
  const fake = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
  fake('claude', `if [ "$1" = "--version" ]; then echo 1; exit 0; fi\necho '{"loggedIn": false}'`);
  fake('zsh', `echo 'shell banner {noise}'\necho '{"loggedIn": ${zshLoggedIn}}'`);
  const env = { PATH: `${bin}:/usr/bin:/bin`, ...(viaZsh ? { SHED_CLAUDE_VIA_ZSH: '1' } : {}) };
  const script = "import('./server/health.js').then(async m => { await m.refreshHarnessHealth(true); console.log(m.harnessHealth().claude.state); process.exit(0); })";
  return spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8', env }).stdout.trim();
}

test('claude login is read from the process env by default', () => {
  assert.equal(claudeState(true, false), 'needs_auth');
});
test('SHED_CLAUDE_VIA_ZSH asks zsh and tolerates shell noise around the JSON', () => {
  assert.equal(claudeState(true, true), 'ready');
  assert.equal(claudeState(false, true), 'needs_auth');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { supersetPane, supersetSend, supersetRead } from '../server/superset.js';
import { typeIntoSuperset } from '../server/terminal.js';

const TERMINAL = 'abe9e467-2cc1-4d76-86e8-4353509e12b4', WORKSPACE = '718e7b6d-67d0-4109-985f-048f2e87284d';
const pane = { terminal: TERMINAL, workspace: WORKSPACE };

function fakeCli() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shed-superset-'));
  const bin = path.join(dir, 'superset'), log = path.join(dir, 'argv');
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\nprintf '%s\\n' "$*" >> '${log}.all'\necho 'line one'\necho 'line two'\n`);
  fs.chmodSync(bin, 0o755);
  process.env.SUPERSET_CLI = bin;
  const argv = () => fs.readFileSync(log, 'utf8').trim().split('\n');
  argv.calls = () => (fs.existsSync(`${log}.all`) ? fs.readFileSync(`${log}.all`, 'utf8').trim().split('\n') : []);
  return argv;
}

test('a process inside a Superset pane reveals its terminal and workspace ids', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { env: { PATH: process.env.PATH, SUPERSET_TERMINAL_ID: TERMINAL, SUPERSET_WORKSPACE_ID: WORKSPACE } });
  try {
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.deepEqual(supersetPane(child.pid), pane);
  } finally { child.kill(); }
  const plain = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { env: { PATH: process.env.PATH } });
  try {
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(supersetPane(plain.pid), null);
  } finally { plain.kill(); }
});

test('send types text with the pane ids, and presses Enter for empty text', async () => {
  const argv = fakeCli();
  await supersetSend(pane, '--looks like a flag');
  assert.deepEqual(argv(), ['terminals', 'send', '--local', '--workspace', WORKSPACE, '--terminal', TERMINAL, '--text=--looks like a flag']);
  await supersetSend(pane, '');
  assert.deepEqual(argv().slice(-2), ['--keys', 'enter']);
});

test('read returns the screen text, trimmed to the last lines', async () => {
  fakeCli();
  assert.equal(await supersetRead(pane, 1), 'line two');
});

test('a failing CLI surfaces its message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shed-superset-'));
  const bin = path.join(dir, 'superset');
  fs.writeFileSync(bin, '#!/bin/sh\necho "no such terminal" >&2\nexit 1\n');
  fs.chmodSync(bin, 0o755);
  process.env.SUPERSET_CLI = bin;
  await assert.rejects(supersetSend(pane, 'hi'), /Superset: no such terminal/);
});

test('a prompt is staged as a bracketed paste, then Enter is sent separately', async () => {
  const argv = fakeCli();
  await typeIntoSuperset(pane, '/dev/ttys999', 'hello', { prompt: true });
  const calls = argv.calls();
  assert.equal(calls.length, 2);
  assert.match(calls[0], /--text=\u001b\[200~hello\u001b\[201~ --no-submit$/);
  assert.match(calls[1], /--keys enter$/);
});

test('if the agent has exited, the line is cleared and Enter is never sent', async () => {
  const argv = fakeCli();
  await assert.rejects(typeIntoSuperset(pane, '/dev/ttys999', 'rm -rf x', { prompt: true, agent: 'claude' }), /exited while the message was being typed|no longer running/);
  const calls = argv.calls();
  assert.ok(calls.some(c => /--keys ctrl\+u$/.test(c)));
  assert.ok(!calls.some(c => /--keys enter$/.test(c)));
});

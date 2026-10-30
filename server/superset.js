import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

// Sessions that live in a Superset pane instead of a Terminal.app tab: Superset puts SUPERSET_TERMINAL_ID and
// SUPERSET_WORKSPACE_ID in the env of every shell it starts, so any process on the tty reveals its pane.
const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const cli = () => {
  if (process.env.SUPERSET_CLI) return process.env.SUPERSET_CLI;
  const home = path.join(os.homedir(), '.superset', 'bin', 'superset');
  return fs.existsSync(home) ? home : 'superset';
};

export function supersetPane(pid) {
  const out = spawnSync('ps', ['eww', '-p', String(pid)], { encoding: 'utf8', timeout: 3000 }).stdout || '';
  const terminal = out.match(new RegExp(`\\bSUPERSET_TERMINAL_ID=${UUID}`))?.[1];
  const workspace = out.match(new RegExp(`\\bSUPERSET_WORKSPACE_ID=${UUID}`))?.[1];
  return terminal && workspace ? { terminal, workspace } : null;
}

export function supersetPaneOnTty(tty) {
  if (!/^\/dev\/ttys\d+$/.test(tty || '')) return null;
  const pids = spawnSync('ps', ['-t', tty.slice(5), '-o', 'pid='], { encoding: 'utf8', timeout: 3000 }).stdout?.trim().split(/\s+/).filter(Boolean) || [];
  for (const pid of pids.slice(0, 4)) { const pane = supersetPane(pid); if (pane) return pane; }
  return null;
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli(), [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(new Error(`Superset could not be reached: ${e.message}`)); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`Superset: ${(err || out).trim().slice(0, 200) || `exit ${code}`}`)); });
  });
}
const target = ({ workspace, terminal }) => ['--local', '--workspace', workspace, '--terminal', terminal];

// Empty text means "press Enter"; anything else is typed and submitted, as Terminal.app's `do script` does.
export function supersetSend(pane, text) {
  return run(['terminals', 'send', ...target(pane), ...(text ? [`--text=${text}`] : ['--keys', 'enter'])]);
}
export async function supersetRead(pane, maxLines = 400) {
  const out = await run(['terminals', 'read', ...target(pane)]);
  return out.replace(/\s+$/, '').split('\n').slice(-maxLines).join('\n');
}

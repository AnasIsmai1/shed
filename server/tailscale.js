import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// Read-only: the only argv ever run are `status --json` and `serve status --json`.
const cache = new Map();
const MAC_APP = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';

let cliPath;
function findCli() {
  if (process.env.TAILSCALE) return process.env.TAILSCALE;
  if (!cliPath) cliPath = probeCli();
  return cliPath;
}
function probeCli() {
  const found = spawnSync('which', ['tailscale'], { encoding: 'utf8', timeout: 3000 }).stdout?.trim();
  return found || (fs.existsSync(MAC_APP) ? MAC_APP : '');
}
function ts(cli, args) {
  const r = spawnSync(cli, args, { encoding: 'utf8', timeout: 3000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}
function lookup(cli, port) {
  if (!cli || ts(cli, ['status', '--json'])?.BackendState !== 'Running') return '';
  const serve = ts(cli, ['serve', 'status', '--json']);
  for (const [key, web] of Object.entries(serve?.Web || {})) {
    const m = key.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net):443$/);
    const proxy = web?.Handlers?.['/']?.Proxy;
    if (!m || typeof proxy !== 'string' || serve.AllowFunnel?.[key]) continue;
    try {
      const u = new URL(proxy.includes('://') ? proxy : 'http://' + proxy);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || Number(u.port) !== port) continue;
    } catch { continue; }
    const url = `https://${m[1]}`;
    if (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(url)) return url;
  }
  return '';
}
// ponytail: spawnSync blocks the event loop up to 3s per call, once per ttl.
export function tailscaleUrl(port, { cli, ttl = 30000 } = {}) {
  const bin = cli ?? findCli();
  const key = `${bin}|${port}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.url;
  let url = '';
  try { url = lookup(bin, port); } catch {}
  cache.set(key, { at: Date.now(), url });
  return url;
}

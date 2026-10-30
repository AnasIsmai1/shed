import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tailscaleUrl } from '../server/tailscale.js';
import { req, startServer } from '../test-helpers/fixture.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shed-ts-'));
const AUTH = { authorization: 'Bearer auth-local-secret' };
const HOST = 'mac.tailnet.ts.net';
const serveFor = (port, key = `${HOST}:443`, proxy = `http://127.0.0.1:${port}`) => ({ Web: { [key]: { Handlers: { '/': { Proxy: proxy } } } } });
function fakeTailscale(dir, { status = { BackendState: 'Running' }, serve = {}, exit = 0, raw } = {}) {
  const file = path.join(dir, 'tailscale');
  const out = j => raw ?? JSON.stringify(j);
  fs.writeFileSync(file, `#!/bin/sh\necho "$*" >> '${dir}/argv.log'\n[ ${exit} -ne 0 ] && exit ${exit}\nif [ "$1" = status ]; then cat <<'EOF1'\n${out(status)}\nEOF1\nelse cat <<'EOF2'\n${out(serve)}\nEOF2\nfi\n`);
  fs.chmodSync(file, 0o755);
  return file;
}
const url = (port, opts) => tailscaleUrl(port, { cli: fakeTailscale(tmp(), opts), ttl: 0 });

test('tailscaleUrl lookup', () => {
  const p = 4378;
  assert.equal(url(p, { serve: serveFor(p) }), `https://${HOST}`);
  assert.equal(url(p, { serve: {} }), '');
  assert.equal(url(p, { status: { BackendState: 'Stopped' }, serve: serveFor(p) }), '');
  assert.equal(url(p, { exit: 1 }), '');
  assert.equal(tailscaleUrl(p, { cli: '/nonexistent/tailscale', ttl: 0 }), '');
  assert.equal(url(p, { serve: serveFor(p + 1) }), '');
  assert.equal(url(p, { serve: serveFor(p, 'mac.example.com:443') }), '');
  assert.equal(url(p, { serve: serveFor(p, `${HOST}:8443`) }), '');
  assert.equal(url(p, { serve: serveFor(p, 'MAC.tailnet.ts.net:443') }), '');
  assert.equal(url(p, { serve: serveFor(p, `${HOST}.:443`) }), '');
  assert.equal(url(p, { serve: serveFor(p, undefined, `localhost:${p}`) }), `https://${HOST}`);
  assert.equal(url(p, { serve: { ...serveFor(p), AllowFunnel: { [`${HOST}:443`]: true } } }), '');
  assert.equal(url(p, { raw: 'garbage' }), '');
});

test('tailscaleUrl is read-only and cached', () => {
  const dir = tmp(), p = 4378;
  const cli = fakeTailscale(dir, { serve: serveFor(p) });
  const lines = () => fs.readFileSync(path.join(dir, 'argv.log'), 'utf8').trim().split('\n');
  tailscaleUrl(p, { cli, ttl: 0 });
  assert.deepEqual(lines().sort(), ['serve status --json', 'status --json']);
  for (const l of lines()) assert.doesNotMatch(l, /funnel|\bup\b|\bset\b/);
  tailscaleUrl(p, { cli });
  const n = lines().length;
  tailscaleUrl(p, { cli });
  assert.equal(lines().length, n);
});

test('tailscale mode server', async () => {
  const start = serve => startServer(port => ({ SHED_TUNNEL: 'tailscale', TAILSCALE: fakeTailscale(tmp(), { serve: serve(port) }) }));
  const { port, child } = await start(serveFor);
  try {
    const local = `localhost:${port}`;
    assert.equal((await req({ port, path: '/api/me', host: local, headers: AUTH })).json.remoteUrl, `https://${HOST}`);
    assert.equal((await req({ port, path: '/api/password/setup', method: 'POST', host: local, body: { password: 'fixture-password' } })).status, 200);
    const login = await req({ port, path: '/api/auth', method: 'POST', host: HOST, body: { password: 'fixture-password' } });
    assert.equal(login.status, 202);
    assert.match(login.headers['set-cookie'][0], /; Secure/);
    const direct = await req({ port, path: '/api/auth', method: 'POST', host: local, body: { password: 'fixture-password' } });
    assert.equal(direct.status, 200);
    assert.doesNotMatch(direct.headers['set-cookie'][0], /Secure/);
    // Tailscale mode keys the rate limit on the last XFF entry; rotating cf-connecting-ip can't escape it.
    const bad = i => req({ port, path: '/api/auth', method: 'POST', host: HOST, headers: { 'x-forwarded-for': '100.64.0.9', 'cf-connecting-ip': `198.51.100.${i}` }, body: { password: 'wrong-wrong-wrong' } });
    for (let i = 0; i < 8; i++) assert.equal((await bad(i)).status, 401);
    assert.equal((await bad(99)).status, 429);
  } finally { child.kill(); }
  const s2 = await start(() => ({}));
  try {
    assert.equal((await req({ port: s2.port, path: '/api/me', host: `localhost:${s2.port}`, headers: AUTH })).json.remoteUrl, '');
  } finally { s2.child.kill(); }
});

test('tunnel.js exits in tailscale mode', async () => {
  const c = spawn(process.execPath, ['server/tunnel.js'], { env: { ...process.env, SHED_TUNNEL: 'tailscale', LAYA_DATA_DIR: tmp(), PATH: '/usr/bin:/bin' } });
  let out = '';
  c.stdout.on('data', d => out += d);
  const code = await new Promise(resolve => { const t = setTimeout(() => { c.kill(); resolve(-1); }, 5000); c.on('exit', x => { clearTimeout(t); resolve(x); }); });
  assert.equal(code, 0);
  assert.match(out, /SHED_TUNNEL=tailscale/);
});

test('install.sh tailscale branch (static)', () => {
  const file = 'site/install.sh', text = fs.readFileSync(file, 'utf8');
  const sc = spawnSync('shellcheck', [file]);
  if (!sc.error) assert.equal(sc.status, 0, sc.stdout?.toString());
  for (const l of text.split('\n').filter(l => l.includes('tailscale serve'))) assert.match(l, /^\s*say /);
  assert.doesNotMatch(text, /^\s*tailscale\s/m);
  assert.match(text, /else\n\s*rm -f "\$AGENTS\/\$LABEL\.tunnel\.plist"\nfi/);
  assert.match(text, /if \[ "\$TUNNEL" = cloudflared \]; then\n\s*plist tunnel tunnel\.js\n\s*launchctl bootstrap "\$DOMAIN" "\$AGENTS\/\$LABEL\.tunnel\.plist"/);
  assert.match(text, /else\n\s*TS_ENV="<key>SHED_TUNNEL<\/key><string>tailscale<\/string>"\nfi/);
  assert.match(text, /\$CF_ENV\$TS_ENV/);
});


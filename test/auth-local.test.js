import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { req, startServer } from '../test-helpers/fixture.js';

const wrong = (port, headers, host, address) => req({ port, path: '/api/auth', method: 'POST', host, address, headers, body: { password: 'nope-nope-nope' } });

test('loopback auth needs a loopback Host and no proxy headers', async () => {
  const { port, child } = await startServer();
  try {
    const status = async (host, headers) => (await req({ port, path: '/api/auth/status', host, headers })).json.canSetup;
    assert.equal(await status(`localhost:${port}`), true);
    assert.equal(await status(`LOCALHOST:${port}`), true);
    assert.equal(await status('mac.tailnet.ts.net'), false);
    assert.equal(await status('localhost.evil.com'), false);
    assert.equal(await status('127.0.0.1.evil.com'), false);
    for (const h of ['tailscale-user-login', 'tailscale-user-name', 'tailscale-user-profile-pic', 'tailscale-app-capabilities', 'x-forwarded-for'])
      assert.equal(await status('localhost', { [h]: 'x' }), false, h);
    const setup = host => req({ port, path: '/api/password/setup', method: 'POST', host, body: { password: 'fixture-password' } });
    assert.equal((await setup('mac.tailnet.ts.net')).status, 403);
    assert.equal(await status(`localhost:${port}`), true);
    assert.equal((await setup(`localhost:${port}`)).status, 200);
    // Non-local Host, no proxy headers: pending device; cookie not Secure outside tailscale mode.
    const login = await req({ port, path: '/api/auth', method: 'POST', host: 'mac.tailnet.ts.net', body: { password: 'fixture-password' } });
    assert.equal(login.status, 202);
    assert.doesNotMatch(login.headers['set-cookie'][0], /Secure/);
    // Rate limit keys on cf-connecting-ip, then the last XFF entry; a rotating client-set XFF can't escape it.
    const local = `localhost:${port}`;
    for (let i = 0; i < 8; i++) assert.equal((await wrong(port, { 'cf-connecting-ip': '203.0.113.1', 'x-forwarded-for': `1.2.3.${i}, 10.0.0.1` }, local)).status, 401);
    assert.equal((await wrong(port, { 'cf-connecting-ip': '203.0.113.1', 'x-forwarded-for': '1.2.3.99' }, local)).status, 429);
    assert.equal((await wrong(port, { 'cf-connecting-ip': '203.0.113.2' }, local)).status, 401);
    for (let i = 0; i < 8; i++) assert.equal((await wrong(port, { 'x-forwarded-for': `9.9.9.${i}, 203.0.113.5` }, local)).status, 401);
    assert.equal((await wrong(port, { 'x-forwarded-for': '9.9.9.99, 203.0.113.5' }, local)).status, 429);
  } finally { child.kill(); }
});

const lanIp = Object.values(os.networkInterfaces()).flat().find(a => a?.family === 'IPv4' && !a.internal)?.address;
test('x-forwarded-for is ignored for non-loopback sockets', { skip: !lanIp }, async () => {
  const { port, child } = await startServer({ SHED_LAN: '1', HOST: '0.0.0.0' });
  try {
    const host = `${lanIp}:${port}`;
    for (let i = 0; i < 8; i++) assert.equal((await wrong(port, { 'x-forwarded-for': `198.51.100.${i}` }, host, lanIp)).status, 401);
    assert.equal((await wrong(port, { 'x-forwarded-for': '198.51.100.99', 'cf-connecting-ip': '198.51.100.98' }, host, lanIp)).status, 429);
  } finally { child.kill(); }
});

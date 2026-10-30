import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
// Raw http.request so tests can set Host (fetch cannot).
export function req({ port, path: p = '/', method = 'GET', host, headers = {}, body, address = '127.0.0.1' }) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const h = { ...(host === undefined ? {} : { host }), ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers };
    const r = http.request({ host: address, port, path: p, method, headers: h }, res => {
      let text = '';
      res.on('data', c => text += c);
      res.on('end', () => { let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, json }); });
    });
    r.on('error', reject);
    r.end(data);
  });
}
// env may be a function of the chosen port.
export async function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shed-auth-'));
  fs.mkdirSync(path.join(dir, 'home'));
  const port = await freePort();
  if (typeof env === 'function') env = env(port);
  const child = spawn(process.execPath, ['server/index.js'], { cwd: path.resolve('.'), stdio: 'ignore', env: { ...process.env, HOME: path.join(dir, 'home'), LAYA_DATA_DIR: path.join(dir, 'data'), LAYA_TOKEN: 'auth-local-secret', LAYA_PRELOAD: '0', HOST: '127.0.0.1', PORT: String(port), ...env } });
  for (let i = 0; i < 100; i++) {
    try { if ((await req({ port, path: '/api/auth/status', host: `127.0.0.1:${port}` })).status === 200) return { port, child }; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error('Server did not start.');
}

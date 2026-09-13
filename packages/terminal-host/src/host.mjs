import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import pty from 'node-pty';
import { Screen } from './screen.mjs';
import { validate, admitCreate, LIMITS, PROTOCOL_VERSION, DeliveryRing } from './protocol.mjs';
import { privateDirectory } from './security.mjs';
export async function serve(directory) {
  await privateDirectory(directory);
  await mkdir(join(directory, 'host.lock'), { mode: 0o700 });
  const epoch = randomUUID();
  const token = randomBytes(32).toString('hex');
  const sessions = new Map();
  const creates = new Map();
  const ended = new Map();
  let maxQueuedBytes = 0;
  let stopping = false;
  let requests = Promise.resolve();
  async function dispatch(method, p) {
    validate(method, p);
    if (stopping) throw Error('STOPPING');
    if (method === 'status') return { protocol: PROTOCOL_VERSION, maxQueuedBytes, epoch, pid: process.pid, sessions: sessions.size };
    if (method === 'list') return { sessions: [...sessions.values()].filter(s => s.scope === p.scope).map(s => ({ terminalId: s.id, pid: s.pty.pid })) };
    if (method === 'create') {
      const key = JSON.stringify([p.scope, p.requestId]);
      if (creates.has(key)) return creates.get(key);
      admitCreate(sessions.size, creates.size);
      const id = randomUUID();
      const child = pty.spawn(p.file, p.args || [], { name: 'xterm-256color', cols: p.cols ?? 80, rows: p.rows ?? 24, cwd: p.cwd || process.cwd(), env: process.env, encoding: null });
      const s = { id, scope: p.scope, pty: child, generation: 0, delivery: new DeliveryRing(), screen: new Screen({ cols: p.cols ?? 80, rows: p.rows ?? 24 }) };
      sessions.set(id, s);
      s.screen.onEvent = event => s.delivery.push(event);
      s.screen.term.onData(data => { try { child.write(data); } catch {} });
      let pendingBytes = 0;
      child.onData(data => {
        const size = Buffer.byteLength(data);
        pendingBytes += size;
        maxQueuedBytes = Math.max(maxQueuedBytes, pendingBytes);
        if (pendingBytes >= 256 * 1024) child.pause();
        void s.screen.write(data).finally(() => {
          pendingBytes -= size;
          if (pendingBytes < 64 * 1024 && !s.exit) child.resume();
        });
      });
      child.onExit(exit => { void s.screen.enqueue(() => {
        s.exit = exit; ended.set(id, s); sessions.delete(id); s.screen.dispose();
        s.screen = null; if (ended.size > 64) ended.delete(ended.keys().next().value);
      }); });
      const result = { terminalId: id, pid: child.pid, epoch };
      creates.set(key, result);
      return result;
    }
    if (method === 'stop') {
      if (sessions.size && !p.force) throw Error('LIVE_SESSIONS');
      stopping = true;
      for (const s of sessions.values()) s.pty.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
      setTimeout(async () => { await rm(join(directory, 'endpoint.json'), { force: true }); await rm(join(directory, 'host.lock'), { recursive: true, force: true }); server.close(); process.exit(0); }, 100);
      return { stopped: true };
    }
    const s = sessions.get(p.terminalId) || (method === 'read' ? ended.get(p.terminalId) : undefined);
    if (!s) throw Error('NOT_FOUND');
    if (s.scope !== p.scope) throw Error('SCOPE_MISMATCH');
    if (method === 'attach') return { snapshot: await s.screen.snapshot(), pid: s.pty.pid, identity: { terminalId: s.id, scope: s.scope, generation: ++s.generation, epoch } };
    if (['input', 'detach', 'resize'].includes(method) && p.generation !== s.generation) throw Error('STALE_WRITER');
    if (method === 'detach') { s.generation++; return {}; }
    if (method === 'input') { s.pty.write(p.data); return {}; }
    if (method === 'resize') { await s.screen.resize(p.cols, p.rows); s.pty.resize(p.cols, p.rows); return {}; }
    if (method === 'read') {
      return { events: s.delivery.read(p.after), exit: s.exit || null };
    }
    if (method === 'terminate') { s.pty.kill(process.platform === 'win32' ? undefined : 'SIGKILL'); return {}; }
    throw Error('UNKNOWN_METHOD');
  }
  const server = http.createServer(async (req, res) => {
    req.setTimeout(5000, () => req.destroy());
    res.setTimeout(5000, () => res.destroy());
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== `Bearer ${token}` || req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined || req.headers.host !== `127.0.0.1:${server.address().port}` || req.method !== 'POST' || req.url !== '/rpc') {
      res.writeHead(403); res.end(JSON.stringify({ error: 'FORBIDDEN' })); return;
    }
    try {
      const chunks = []; let bytes = 0;
      for await (const part of req) {
        bytes += part.length;
        if (bytes > LIMITS.requestBytes) throw Error('REQUEST_TOO_LARGE');
        chunks.push(part);
      }
      const { method, params, epoch: requestedEpoch } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (requestedEpoch !== epoch || (params?.epoch && params.epoch !== epoch)) throw Error('HOST_LOST');
      // Serialize lease-changing RPCs across async screen barriers.
      const result = requests.then(() => dispatch(method, params));
      requests = result.catch(() => {});
      res.end(JSON.stringify({ result: await result }));
    } catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: error.message })); }
  });
  server.maxConnections = 32;
  server.maxRequestsPerSocket = 1;
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  await writeFile(join(directory, 'endpoint.json'), JSON.stringify({ port: server.address().port, epoch, token }), { mode: 0o600 });
}

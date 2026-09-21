import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, lstat, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import pty from 'node-pty';
import { ownProcessTree } from './process-tree.mjs';
import { Screen } from './screen.mjs';
import { validate, admitCreate, LIMITS, PROTOCOL_VERSION, DeliveryRing } from './protocol.mjs';
import { privateDirectory, publishEndpoint } from './security.mjs';
export async function serve(directory) {
  await privateDirectory(directory);
  const lockPath = join(directory, 'host.lock');
  await mkdir(lockPath, { mode: 0o700 });
  const lockIdentity = await lstat(lockPath);
  async function releaseLock() {
    const current = await lstat(lockPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (current?.dev === lockIdentity.dev && current?.ino === lockIdentity.ino) await rmdir(lockPath);
  }
  const epoch = randomUUID();
  const token = randomBytes(32).toString('hex');
  const sessions = new Map();
  const creates = new Map();
  const ended = new Map();
  let maxQueuedBytes = 0;
  let pendingRequests = 0;
  let stopping = false;
  let removeEndpoint = async () => {};
  function alive(s) {
    if (s.lifetime.signal.aborted) throw s.lifetime.signal.reason;
  }
  function barrier(s, promise, observeLifetime = true) {
    return new Promise((resolve, reject) => {
      const signal = s.lifetime.signal;
      const settle = (fn, value) => {
        clearTimeout(timer); signal.removeEventListener('abort', abort); fn(value);
      };
      const abort = () => settle(reject, signal.reason);
      const timer = setTimeout(() => { fail(s); settle(reject, Error('SCREEN_FAILED')); }, 4000);
      if (observeLifetime) signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(value => settle(resolve, value), error => settle(reject, error));
      if (observeLifetime && signal.aborted) abort();
    });
  }
  function finish(s, exit) {
    if (s.finalized) return;
    s.finalized = true;
    s.exit = exit;
    s.lifetime.abort(Error(s.failure || 'SESSION_ENDED'));
    try { s.screen.dispose(); } catch { s.failure = 'SCREEN_FAILED'; }
    ended.set(s.id, s); sessions.delete(s.id);
    if (ended.size > 64) ended.delete(ended.keys().next().value);
  }
  function fail(s) {
    if (s.failure) return;
    s.failure = 'SCREEN_FAILED';
    s.lifetime.abort(Error(s.failure));
    try { s.screen.dispose(); } catch {}
    try { s.kill(); } catch (error) { s.cleanupError = error.message; }
    if (s.nativeExit) finish(s, s.nativeExit);
  }
  async function dispatch(method, p, check = () => {}) {
    check();
    validate(method, p);
    if (method === 'status') return { protocol: PROTOCOL_VERSION, maxQueuedBytes, epoch, pid: process.pid, sessions: sessions.size };
    if (stopping) throw Error('STOPPING');
    if (method === 'list') return { metadataVersion: 1, sessions: [...sessions.values()].filter(s => s.scope === p.scope).map(s => ({ terminalId: s.id, pid: s.pty.pid, epoch, ...(s.metadata ? { metadata: s.metadata } : {}) })) };
    if (method === 'create') {
      const key = JSON.stringify([p.scope, p.requestId]);
      if (creates.has(key)) return creates.get(key);
      admitCreate(sessions.size, creates.size);
      const id = randomUUID();
      const child = pty.spawn(p.file, p.args || [], { name: 'xterm-256color', cols: p.cols ?? 80, rows: p.rows ?? 24, cwd: p.cwd || process.cwd(), env: p.env ?? process.env, encoding: null });
      const s = { id, scope: p.scope, pty: child, generation: 0, writers: new Set(), metadata: p.metadata, delivery: new DeliveryRing(), screen: new Screen({ cols: p.cols ?? 80, rows: p.rows ?? 24 }) };
      s.kill = ownProcessTree(child);
      s.lifetime = new AbortController();
      s.requests = Promise.resolve();
      s.pendingRequests = 0;
      sessions.set(id, s);
      s.screen.onEvent = event => s.delivery.push(event);
      s.screen.term.onData(data => { try { child.write(data); } catch {} });
      let pendingBytes = 0;
      child.onData(data => {
        if (s.failure || s.finalized) return;
        const size = Buffer.byteLength(data);
        pendingBytes += size;
        maxQueuedBytes = Math.max(maxQueuedBytes, pendingBytes);
        if (pendingBytes >= 256 * 1024) child.pause();
        void barrier(s, Promise.resolve().then(() => s.screen.write(data)), false).then(() => {
          pendingBytes -= size;
          if (pendingBytes < 64 * 1024 && !s.nativeExit && !s.failure) child.resume();
        }).catch(() => { pendingBytes -= size; fail(s); });
      });
      child.onExit(exit => {
        s.nativeExit = exit;
        if (s.failure) { finish(s, exit); return; }
        void barrier(s, Promise.resolve().then(() => s.screen.enqueue(() => finish(s, exit))), false).catch(() => fail(s));
      });
      const result = { terminalId: id, pid: child.pid, epoch };
      creates.set(key, result);
      return result;
    }
    if (method === 'stop') {
      if (sessions.size && !p.force) throw Error('LIVE_SESSIONS');
      stopping = true;
      let failed = false;
      for (const s of sessions.values()) {
        try { s.kill(); s.lifetime.abort(Error('SESSION_ENDED')); }
        catch (error) { s.cleanupError = error.message; failed = true; }
      }
      if (failed) { stopping = false; throw Error('TERMINATION_FAILED'); }
      setTimeout(() => {
        void (async () => {
          await removeEndpoint(); await releaseLock(); server.close(); process.exit(0);
        })().catch(() => { server.closeAllConnections(); server.close(); process.exit(1); });
      }, 100);
      return { stopped: true };
    }
    const s = sessions.get(p.terminalId) || (method === 'read' ? ended.get(p.terminalId) : undefined);
    if (!s) throw Error('NOT_FOUND');
    if (s.scope !== p.scope) throw Error('SCOPE_MISMATCH');
    if (method === 'attach') {
      alive(s);
      const snapshot = await barrier(s, s.screen.snapshot());
      check(); alive(s);
      const generation = ++s.generation;
      s.writers.add(generation);
      return { snapshot, pid: s.pty.pid, identity: { terminalId: s.id, scope: s.scope, generation, epoch } };
    }
    if (['input', 'detach', 'resize'].includes(method)) {
      alive(s);
      if (!s.writers.has(p.generation)) throw Error('STALE_WRITER');
    }
    if (method === 'detach') { s.writers.delete(p.generation); return {}; }
    if (method === 'update') { s.metadata = p.metadata; return {}; }
    if (method === 'input') { s.pty.write(p.data); return {}; }
    if (method === 'resize') { await barrier(s, s.screen.resize(p.cols, p.rows, () => { check(); alive(s); })); check(); alive(s); s.pty.resize(p.cols, p.rows); return {}; }
    if (method === 'read') {
      return { events: s.delivery.read(p.after), exit: s.exit || null, ...(s.failure ? { failure: s.failure, cleanupError: s.cleanupError } : {}) };
    }
    if (method === 'terminate') { s.kill(); s.lifetime.abort(Error('SESSION_ENDED')); return {}; }
    throw Error('UNKNOWN_METHOD');
  }
  const server = http.createServer(async (req, res) => {
    let cancelled = false;
    const cancel = () => { cancelled = true; };
    const check = () => { if (cancelled) throw Error('REQUEST_CANCELLED'); };
    req.once('aborted', cancel);
    res.once('close', cancel);
    const deadline = setTimeout(() => { cancel(); res.destroy(); }, 5000);
    res.once('close', () => clearTimeout(deadline));
    req.setTimeout(5000, () => { cancel(); req.destroy(); });
    res.setTimeout(5000, () => { cancel(); res.destroy(); });
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
      // Only writer operations for the same terminal share a queue. Admin RPCs
      // never wait for screen progress; create remains synchronously atomic.
      const s = ['attach', 'input', 'resize', 'detach', 'update'].includes(method) && sessions.get(params?.terminalId);
      validate(method, params);
      if (s && s.scope !== params.scope) throw Error('SCOPE_MISMATCH');
      if (s && (s.pendingRequests >= 8 || pendingRequests >= 24)) throw Error('QUEUE_FULL');
      if (s) { s.pendingRequests++; pendingRequests++; }
      const result = s ? s.requests.then(() => dispatch(method, params, check)) : dispatch(method, params, check);
      if (s) s.requests = result.then(() => {}, () => {}).then(() => { s.pendingRequests--; pendingRequests--; });
      res.end(JSON.stringify({ result: await result }));
    } catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: error.message })); }
  });
  server.maxConnections = 32;
  server.maxRequestsPerSocket = 1;
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    removeEndpoint = await publishEndpoint(directory, { port: server.address().port, epoch, token });
  } catch (error) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await releaseLock();
    throw error;
  }
}

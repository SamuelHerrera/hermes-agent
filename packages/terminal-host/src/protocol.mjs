export const PROTOCOL_VERSION = 1;
export const LIMITS = Object.freeze({ inputBytes: 65536, requestBytes: 128 * 1024, eventBytes: 256 * 1024, sessions: 64, creates: 10000 });
// Delivery retention only. An evicted event requires a fresh state checkpoint.
export class DeliveryRing {
  constructor(maxBytes = LIMITS.eventBytes) { this.maxBytes = maxBytes; this.bytes = 0; this.seq = 0; this.entries = []; }
  push(event) {
    const bytes = Buffer.byteLength(JSON.stringify(event));
    this.seq = event.seq; this.entries.push({ event, bytes }); this.bytes += bytes;
    while (this.bytes > this.maxBytes && this.entries.length) this.bytes -= this.entries.shift().bytes;
  }
  read(after) {
    if (after < (this.entries[0]?.event.seq ?? this.seq + 1) - 1) throw Error('GAP');
    return this.entries.filter(e => e.event.seq > after).map(e => e.event);
  }
}
const string = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\0');
const dimension = v => Number.isInteger(v) && v >= 2 && v <= 500;
const terminalMetadata = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = new Set(['id', 'title', 'auto', 'cwd', 'restoreCwd', 'projectId', 'profile', 'ownerSessionId', 'hidden']);
  if (Object.keys(value).some(key => !allowed.has(key))) return false;
  if (!string(value.id) || !string(value.title, 1024)) return false;
  if (typeof value.auto !== 'boolean' || typeof value.hidden !== 'boolean') return false;
  return ['cwd', 'restoreCwd', 'projectId', 'profile', 'ownerSessionId'].every(key =>
    value[key] === undefined || (typeof value[key] === 'string' && value[key].length <= 4096 && !value[key].includes('\0'))
  );
};
export function admitCreate(sessions, creates) {
  if (sessions >= LIMITS.sessions) throw Error('SESSION_LIMIT');
  if (creates >= LIMITS.creates) throw Error('CREATE_LIMIT');
}
export function validate(method, p) {
  const check = ok => { if (!ok) throw Error('INVALID_PARAMS'); };
  check(p && typeof p === 'object' && !Array.isArray(p));
  if (['status', 'stop'].includes(method)) { check(p.force === undefined || typeof p.force === 'boolean'); return; }
  check(string(p.scope));
  if (method === 'list') return;
  if (method === 'create') {
    check(string(p.requestId) && string(p.file, 4096));
    check(p.env === undefined || (p.env && typeof p.env === 'object' && !Array.isArray(p.env) &&
      Object.entries(p.env).every(([k, v]) => string(k, 1024) && !k.includes('=') && typeof v === 'string' && !v.includes('\0'))));
    check(p.args === undefined || (Array.isArray(p.args) && p.args.length <= 128 && p.args.every(v => typeof v === 'string' && v.length < 65536 && !v.includes('\0'))));
    check(p.cwd === undefined || string(p.cwd, 4096));
    check(p.cols === undefined || dimension(p.cols));
    check(p.rows === undefined || dimension(p.rows));
    check(p.metadata === undefined || terminalMetadata(p.metadata));
    return;
  }
  check(string(p.terminalId));
  if (method === 'update') { check(terminalMetadata(p.metadata)); return; }
  if (['input', 'resize', 'detach'].includes(method)) check(Number.isSafeInteger(p.generation) && p.generation > 0);
  if (method === 'input') check(typeof p.data === 'string' && Buffer.byteLength(p.data) <= LIMITS.inputBytes);
  if (method === 'resize') check(dimension(p.cols) && dimension(p.rows));
  if (method === 'read') check(Number.isSafeInteger(p.after) && p.after >= 0);
}

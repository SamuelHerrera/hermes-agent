export const PROTOCOL_VERSION = 1;
export const LIMITS = Object.freeze({ inputBytes: 65536, requestBytes: 128 * 1024, eventBytes: 256 * 1024, sessions: 64, creates: 10000 });
const string = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\0');
const dimension = v => Number.isInteger(v) && v >= 2 && v <= 500;
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
    check(p.args === undefined || (Array.isArray(p.args) && p.args.length <= 128 && p.args.every(v => typeof v === 'string' && v.length < 65536 && !v.includes('\0'))));
    check(p.cwd === undefined || string(p.cwd, 4096));
    check(p.cols === undefined || dimension(p.cols));
    check(p.rows === undefined || dimension(p.rows));
    return;
  }
  check(string(p.terminalId));
  if (['input', 'resize', 'detach'].includes(method)) check(Number.isSafeInteger(p.generation) && p.generation > 0);
  if (method === 'input') check(typeof p.data === 'string' && Buffer.byteLength(p.data) <= LIMITS.inputBytes);
  if (method === 'resize') check(dimension(p.cols) && dimension(p.rows));
  if (method === 'read') check(Number.isSafeInteger(p.after) && p.after >= 0);
}

import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connect } from './client.mjs';

export async function installBundle(source, versions) {
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  if (!/^[a-zA-Z0-9._-]+$/.test(manifest.version) || manifest.platform !== process.platform || manifest.arch !== process.arch) throw Error('INVALID_BUNDLE');
  await mkdir(versions, { recursive: true, mode: 0o700 });
  const target = join(versions, manifest.version);
  if (await stat(target).catch(() => null)) return target;
  const temporary = join(versions, `.install-${randomUUID()}`);
  try {
    await cp(source, temporary, { recursive: true, dereference: true });
    try { await rename(temporary, target); }
    catch (error) { if (!['ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
    return target;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

/** A running host wins over newer files. Never restart active sessions for an update. */
export async function ensureHost({ bundle, versions, directory }) {
  try { const live = await connect(directory); await live.request('status'); return live; }
  catch { /* Startup itself fails closed on an existing lock, including a stale one. */ }
  const installed = await installBundle(bundle, versions);
  const node = join(installed, process.platform === 'win32' ? 'node.exe' : 'node');
  const cli = join(installed, 'package', 'src', 'cli.mjs');
  await promisify(execFile)(node, [cli, 'start', '--dir', directory], {
    timeout: 15000, windowsHide: true, maxBuffer: 65536,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'HERMES_PARENT_PID'].includes(key))),
  });
  return connect(directory);
}

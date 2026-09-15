#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { connect } from './client.mjs';
const args = process.argv.slice(2);
const command = args[0];
const index = args.indexOf('--dir');
function staleEndpoint(error) {
  if (error?.code === 'ENOENT') return true;
  if (error?.code === 'HOST_LOST') return true;
  if (error?.cause?.code === 'ECONNREFUSED') return true;
  return error?.name === 'TypeError' && error?.message === 'fetch failed';
}
async function removeStaleRuntime(directory) {
  await rm(join(directory, 'endpoint.json'), { force: true });
  await rm(join(directory, 'host.lock'), { recursive: true, force: true });
}
try {
  if (command === '--version') {
    console.log(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version);
    process.exit(0);
  }
  if (index < 0 || !args[index + 1]) throw Error('--dir is required (explicit per-user runtime directory)');
  const directory = resolve(args[index + 1]);
  if (command === 'install') {
    const { ensureHost } = await import('./install.mjs');
    const runtimeDirectory = join(directory, 'runtime');
    const client = await ensureHost({ bundle: fileURLToPath(new URL('../../', import.meta.url)), versions: join(directory, 'versions'), directory: runtimeDirectory });
    console.log(JSON.stringify({ installed: true, directory: runtimeDirectory, status: await client.request('status') }));
  } else if (command === 'serve') {
    const { serve } = await import('./host.mjs'); await serve(directory);
  } else if (command === 'start') {
    try { console.log(JSON.stringify(await (await connect(directory)).request('status'))); process.exit(0); }
    catch (error) { if (staleEndpoint(error)) await removeStaleRuntime(directory); }
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', '--dir', directory], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    const deadline = Date.now() + 10000;
    while (true) {
      try { console.log(JSON.stringify(await (await connect(directory)).request('status'))); break; }
      catch (error) { if (Date.now() > deadline) throw error; await new Promise(r => setTimeout(r, 30)); }
    }
  } else if (command === 'status' || command === 'stop') {
    console.log(JSON.stringify(await (await connect(directory)).request(command, { force: args.includes('--force') })));
  } else throw Error('expected install, start, status or stop');
} catch (error) { console.error(error.message); process.exitCode = 1; }

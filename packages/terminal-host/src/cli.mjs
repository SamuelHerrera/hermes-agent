#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { connect } from './client.mjs';
const args = process.argv.slice(2);
const command = args[0];
const index = args.indexOf('--dir');
try {
  if (command === '--version') {
    console.log(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version);
    process.exit(0);
  }
  if (index < 0 || !args[index + 1]) throw Error('--dir is required (explicit per-user runtime directory)');
  const directory = resolve(args[index + 1]);
  if (command === 'serve') {
    const { serve } = await import('./host.mjs'); await serve(directory);
  } else if (command === 'start') {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', '--dir', directory], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    const deadline = Date.now() + 10000;
    while (true) {
      try { console.log(JSON.stringify(await (await connect(directory)).request('status'))); break; }
      catch (error) { if (Date.now() > deadline) throw error; await new Promise(r => setTimeout(r, 30)); }
    }
  } else if (command === 'status' || command === 'stop') {
    console.log(JSON.stringify(await (await connect(directory)).request(command, { force: args.includes('--force') })));
  } else throw Error('expected start, status or stop');
} catch (error) { console.error(error.message); process.exitCode = 1; }

#!/usr/bin/env node
// Native-platform payload, also usable as a backend-only install bundle.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = join(root, 'packages/terminal-host');
const destination = resolve(process.argv[2] || join(root, 'apps/desktop/dist/terminal-host'));
const version = '22.22.3';
const platform = process.platform === 'win32' ? 'win' : process.platform;
if (!['win', 'darwin', 'linux'].includes(platform) || !['arm64', 'x64'].includes(process.arch)) throw Error('Unsupported native terminal-host build target');
const name = `node-v${version}-${platform}-${process.arch}`;
const filename = `${name}.${platform === 'win' ? 'zip' : 'tar.gz'}`;
const origin = `https://nodejs.org/dist/v${version}/`;
const temporary = await mkdtemp(join(tmpdir(), 'hermes-host-build-'));
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw Error(`Download failed: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
try {
  const archive = await download(origin + filename);
  const checksums = (await download(origin + 'SHASUMS256.txt')).toString();
  const expected = checksums.split('\n').map(line => line.trim().split(/\s+/)).find(row => row[1] === filename)?.[0];
  if (!expected || createHash('sha256').update(archive).digest('hex') !== expected) throw Error('NODE_CHECKSUM_MISMATCH');
  const archivePath = join(temporary, filename); await writeFile(archivePath, archive);
  if (platform === 'win') {
    const quote = text => text.replaceAll("'", "''");
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${quote(archivePath)}' -DestinationPath '${quote(temporary)}'`], { stdio: 'inherit' });
  } else execFileSync('tar', ['-xzf', archivePath, '-C', temporary], { stdio: 'inherit' });
  const payload = join(temporary, 'payload');
  const pkg = join(payload, 'package'); await mkdir(pkg, { recursive: true });
  for (const file of ['src', 'package.json', 'package-lock.json', 'README.md', 'CHECKPOINTS.md']) await cp(join(source, file), join(pkg, file), { recursive: true });
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--workspaces=false', '--no-audit', '--no-fund'], { cwd: pkg, stdio: 'inherit', shell: process.platform === 'win32' });
  const node = platform === 'win' ? 'node.exe' : 'node';
  await cp(join(temporary, name, platform === 'win' ? 'node.exe' : 'bin/node'), join(payload, node));
  await cp(join(temporary, name, 'LICENSE'), join(payload, 'NODE-LICENSE'));
  if (platform !== 'win') await chmod(join(payload, node), 0o755);
  const hash = createHash('sha256');
  // Full source tree identity includes the lockfile and checkpoint adapter.
  const { readdir } = await import('node:fs/promises');
  for (const file of (await readdir(join(source, 'src'))).sort()) hash.update(file).update(await readFile(join(source, 'src', file)));
  hash.update(await readFile(join(source, 'package-lock.json'))).update(expected);
  await writeFile(join(payload, 'manifest.json'), JSON.stringify({ version: `0.1.0-${hash.digest('hex').slice(0, 20)}`, platform: process.platform, arch: process.arch, node: version }));
  execFileSync(join(payload, node), [join(pkg, 'src/cli.mjs'), '--version'], { stdio: 'inherit' });
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(payload, destination, { recursive: true });
  console.log(`Terminal host bundle: ${destination}`);
} finally { await rm(temporary, { recursive: true, force: true }); }

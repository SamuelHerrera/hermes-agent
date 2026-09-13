// node-pty 1.1.0 npm tarball omits executable bits on Darwin helpers.
import { createRequire } from 'node:module';
import { chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
if (process.platform === 'darwin') {
  const root = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
  for (const relative of [`prebuilds/darwin-${process.arch}/spawn-helper`, 'build/Release/spawn-helper']) {
    const file = join(root, relative);
    if (existsSync(file)) chmodSync(file, 0o755);
  }
}

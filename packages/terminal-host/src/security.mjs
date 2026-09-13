import { lstat, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
export async function privateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('UNSAFE_DIRECTORY');
  if (process.platform !== 'win32') {
    if (info.uid !== process.getuid() || (info.mode & 0o077)) throw Error('UNSAFE_DIRECTORY');
  } else {
    // chmod does not protect secrets on Windows. Replace inherited/explicit DACL
    // with current SID only, before writing endpoint/token. Fail closed on error.
    const quoted = directory.replaceAll("'", "''");
    const script = `$ErrorActionPreference='Stop';
      $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;
      $acl=New-Object Security.AccessControl.DirectorySecurity;
      $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false);
      $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow');
      $acl.AddAccessRule($rule); Set-Acl -LiteralPath '${quoted}' -AclObject $acl;`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'pipe', windowsHide: true, timeout: 10000 });
  }
}

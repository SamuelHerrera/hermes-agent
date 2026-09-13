import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

function windowsPrivate(path, directory) {
  const quoted = path.replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop';
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;
    $acl=New-Object Security.AccessControl.${directory ? 'DirectorySecurity' : 'FileSecurity'};
    $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false);
    $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl',${directory ? "'ContainerInherit,ObjectInherit'" : "'None'"},'None','Allow');
    $acl.AddAccessRule($rule); Set-Acl -LiteralPath '${quoted}' -AclObject $acl;
    $verified=Get-Acl -LiteralPath '${quoted}';
    if(!$verified.AreAccessRulesProtected -or $verified.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'UNSAFE_ACL'};
    $rules=@($verified.Access);
    if($rules.Count -ne 1){throw 'UNSAFE_ACL'};
    foreach($r in $rules){
      if($r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $r.AccessControlType -ne 'Allow' -or $r.FileSystemRights -ne 'FullControl'){throw 'UNSAFE_ACL'}
    }`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'pipe', windowsHide: true, timeout: 10000 });
}

export async function privateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('UNSAFE_DIRECTORY');
  if (process.platform !== 'win32') {
    if (info.uid !== process.getuid() || (info.mode & 0o077)) throw Error('UNSAFE_DIRECTORY');
  } else {
    // chmod cannot protect Windows secrets. Replace and verify the entire DACL.
    windowsPrivate(directory, true);
  }
}

// Never overwrite an existing inode: it may have explicit foreign Windows ACEs,
// POSIX permissions, hardlinks or readers holding a previously public handle.
export async function publishEndpoint(directory, endpoint) {
  await privateDirectory(directory);
  const path = join(directory, 'endpoint.json');
  const temporary = join(directory, `.endpoint-${randomUUID()}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  try {
    if (process.platform === 'win32') windowsPrivate(temporary, false);
    const info = await lstat(temporary);
    if (!info.isFile() || info.isSymbolicLink() ||
        (process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o077)))) throw Error('UNSAFE_ENDPOINT');
    await file.writeFile(JSON.stringify(endpoint));
    await file.sync();
    await file.close();
    await rename(temporary, path);
    // Cleanup capability is bound to the inode this attempt published.
    return async () => {
      const current = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (current?.dev === info.dev && current?.ino === info.ino) await rm(path);
    };
  } finally {
    await file.close();
    await rm(temporary, { force: true });
  }
}

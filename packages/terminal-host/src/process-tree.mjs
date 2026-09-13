import { execFileSync } from 'node:child_process';

function processes() {
  return execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,uid=,tty=,lstart='], {
    encoding: 'utf8', timeout: 2000, maxBuffer: 8 * 1024 * 1024,
  }).trim().split('\n').map(line => {
    const [pid, ppid, pgid, uid, tty, ...start] = line.trim().split(/\s+/);
    return { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), uid: Number(uid), tty, start: start.join(' ') };
  });
}
const same = (a, b) => a && b && a.pid === b.pid && a.ppid === b.ppid &&
  a.uid === b.uid && a.start === b.start;

// Keep the original leader identity, not an untrusted caller-supplied PID.
export function ownProcessTree(child) {
  let exited = false;
  child.onExit(() => { exited = true; });
  const owner = process.platform === 'win32' ? null : processes().find(p => p.pid === child.pid);
  return () => {
    if (exited) return;
    if (process.platform === 'win32') {
      // Native Windows release gate: taskkill's tree enumeration, not leader-only
      // TerminateProcess. The live node-pty handle anchors the owned leader.
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 5000, stdio: 'pipe', windowsHide: true });
      child.kill();
      return;
    }
    const table = processes();
    const leader = table.find(p => p.pid === child.pid);
    if (!leader) return; // Native exit callback may still be in flight.
    const tty = child.ptsName.replace(/^\/dev\//, '');
    if (!same(owner, leader) || leader.ppid !== process.pid || leader.uid !== process.getuid() || leader.pgid !== leader.pid || (leader.tty !== tty && !/^\?/.test(leader.tty))) {
      throw Error('PROCESS_OWNERSHIP_LOST');
    }
    // Job-control shells put foreground/background jobs in different groups.
    // A live, identity-checked PTY leader anchors its controlling terminal;
    // include every same-user group on that terminal, never detached daemons.
    // Before the fork helper opens its slave, ps reports '?'. In that interval
    // only its anchored process group is owned; never enumerate all '?' jobs.
    const groups = [...new Set([leader.pgid, ...table.filter(p => leader.tty === tty && p.tty === tty && p.uid === leader.uid).map(p => p.pgid)])];
    groups.sort((a, b) => Number(a === leader.pgid) - Number(b === leader.pgid));
    for (const group of groups) {
      const fresh = processes();
      if (!same(owner, fresh.find(p => p.pid === child.pid))) throw Error('PROCESS_OWNERSHIP_LOST');
      const members = fresh.filter(p => p.pgid === group);
      if (group <= 1 || !members.length || members.some(p => (p.tty !== tty && !(group === leader.pgid && /^\?/.test(p.tty))) || p.uid !== leader.uid || p.pid === process.pid)) continue;
      try { process.kill(-group, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  };
}

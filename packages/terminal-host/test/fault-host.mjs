// Separate-process fault injection only. No production config/environment knobs.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { Screen } from '../src/screen.mjs';
import { serve } from '../src/host.mjs';
const snapshot = Screen.prototype.snapshot;
const write = Screen.prototype.write;
const enqueue = Screen.prototype.enqueue;
let release, rejectExit = false;
const execFileSync = childProcess.execFileSync;
Screen.prototype.snapshot = function () {
  if (this.term.cols !== 81 || this.stalledOnce) return snapshot.call(this);
  this.stalledOnce = true;
  const result = snapshot.call(this);
  process.send?.('snapshot-entered');
  return new Promise(resolve => { release = () => resolve(result); });
};
Screen.prototype.write = function (data) {
  if (this.term.cols === 82) return Promise.reject(Error('injected write failure'));
  return write.call(this, data);
};
Screen.prototype.enqueue = function (fn) {
  if (rejectExit && this.term.cols === 83) return Promise.reject(Error('injected exit failure'));
  return enqueue.call(this, fn);
};
process.on('message', message => {
  if (message === 'kill-fail' || message === 'kill-restore') {
    childProcess.execFileSync = message === 'kill-fail' ? () => { throw Error('PROCESS_QUERY_FAILED'); } : execFileSync;
    syncBuiltinESMExports(); process.send?.(message);
  }
  if (message === 'release') release?.();
  if (message === 'reject-exit') { rejectExit = true; process.send?.('exit-armed'); }
});
await serve(process.argv[2]);
process.send?.('ready');

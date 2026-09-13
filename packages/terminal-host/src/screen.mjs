import xterm from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import { StringDecoder } from 'node:string_decoder';
const { Terminal } = xterm;
const { SerializeAddon } = serialize;
const write = (term, data) => new Promise(resolve => term.write(data, resolve));
export class Screen {
  constructor({ cols = 80, rows = 24, maxReplayBytes = 2 * 1024 * 1024 } = {}) {
    this.initial = { cols, rows };
    this.term = new Terminal({ cols, rows, scrollback: 2000, allowProposedApi: true });
    this.serializer = new SerializeAddon();
    this.term.loadAddon(this.serializer);
    this.decoder = new StringDecoder('utf8');
    this.queue = Promise.resolve();
    this.replay = [];
    this.replayBytes = 0;
    this.maxReplayBytes = maxReplayBytes;
    this.seq = 0;
  }
  enqueue(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
  record(event) {
    event = { ...event, seq: ++this.seq };
    this.replayBytes += Buffer.byteLength(JSON.stringify(event));
    if (this.replayBytes > this.maxReplayBytes) this.replay = null;
    this.replay?.push(event);
    this.onEvent?.(event);
  }
  write(bytes) {
    const data = typeof bytes === 'string' ? bytes : this.decoder.write(bytes);
    return this.enqueue(async () => {
      if (!data) return;
      await write(this.term, data);
      this.record({ type: 'data', data });
    });
  }
  resize(cols, rows) {
    return this.enqueue(() => {
      this.term.resize(cols, rows);
      this.record({ type: 'resize', cols, rows });
    });
  }
  snapshot() {
    return this.enqueue(() => ({ cols: this.term.cols, rows: this.term.rows,
      data: this.serializer.serialize(), seq: this.seq, initial: this.initial,
      exact: this.replay !== null, replay: this.replay ? [...this.replay] : null }));
  }
  dispose() { this.term.dispose(); }
}
// The caller MUST suppress terminal-generated replies during restore and live playback.
// Only physical keyboard/paste events may flow to the PTY input API.
export async function restoreScreen(term, snapshot) {
  if (!snapshot.exact) throw Error('RECONSTRUCTION_LIMIT');
  term.reset();
  term.resize(snapshot.initial.cols, snapshot.initial.rows);
  for (const event of snapshot.replay) {
    if (event.type === 'resize') term.resize(event.cols, event.rows);
    else await write(term, event.data);
  }
}

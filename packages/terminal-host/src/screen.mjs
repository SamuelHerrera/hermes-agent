import xterm from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import { StringDecoder } from 'node:string_decoder';
import { captureTerminalState, hydrateTerminalState, initializeTerminalState } from './xterm-state-v1.mjs';
const { Terminal } = xterm;
const { SerializeAddon } = serialize;
const write = (term, data) => new Promise(resolve => term.write(data, resolve));
export class Screen {
  constructor({ cols = 80, rows = 24 } = {}) {
    this.term = new Terminal({ cols, rows, scrollback: 2000, allowProposedApi: true });
    initializeTerminalState(this.term);
    this.serializer = new SerializeAddon();
    // Serializer is an approximate preview only, not a parser addon/profile.
    this.serializer.activate(this.term);
    this.decoder = new StringDecoder('utf8');
    this.queue = Promise.resolve();
    this.seq = 0;
  }
  enqueue(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
  record(event) {
    event = { ...event, seq: ++this.seq };
    this.onEvent?.(event);
  }
  write(bytes) {
    return this.enqueue(async () => {
      const data = typeof bytes === 'string' ? bytes : this.decoder.write(bytes);
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
    return this.enqueue(() => ({ ...captureTerminalState(this.term, { seq: this.seq }),
      preview: { approximate: true, data: this.serializer.serialize() } }));
  }
  dispose() { this.term.dispose(); }
}
// The caller MUST suppress terminal-generated replies during restore and live playback.
// Only physical keyboard/paste events may flow to the PTY input API.
export async function restoreScreen(term, snapshot) {
  hydrateTerminalState(term, snapshot);
}

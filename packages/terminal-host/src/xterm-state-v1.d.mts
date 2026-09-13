import type { Terminal } from '@xterm/xterm';

export interface TerminalCheckpoint {
  format: 'hermes-xterm-state';
  version: 1;
  seq?: number;
  cols: number;
  rows: number;
  [field: string]: unknown;
}
export function initializeTerminalState(terminal: Terminal): void;
export function captureTerminalState(terminal: Terminal, metadata?: { seq?: number }): TerminalCheckpoint;
export function hydrateTerminalState(terminal: Terminal, state: TerminalCheckpoint): void;
export function assertCompatibleTerminal(terminal: Terminal): void;

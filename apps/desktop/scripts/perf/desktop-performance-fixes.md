# Hermes Desktop Performance Fixes

## Delivery strategy

Ship one independently measurable fix at a time. After each step:

1. run the focused behavior tests, Desktop lint, typecheck, and build;
2. pack and deploy a clean `/Applications/Hermes.app`;
3. reopen the installed app with the same multi-session workload;
4. record renderer CPU/RSS, GPU-helper CPU, and perceived responsiveness;
5. continue only after the preceding change is validated.

The baseline and evidence are in [`desktop-cpu-gpu-investigation.md`](./desktop-cpu-gpu-investigation.md).

## Step 1 — Replace infinite session-status spinners

**Status:** implemented, dogfooded, and visually corrected.

### Problem

A working session used an infinite one-second CSS rotation in every sidebar row and tab lead. Eight sessions created about sixteen permanent compositor animations. An isolated 12-spinner probe raised GPU-process CPU from 0.3% to 9.5% and renderer CPU from 0.1% to 5.0%.

### Change

Replace the infinite rotation with the existing shared `StatusPulse` mechanism:

- retain the stable project-color dot;
- retain the original 0.75rem Codicon glyph geometry rather than substituting a heavier CSS border ring;
- briefly pulse the glyph once every five seconds;
- synchronize all status pulses through one scheduler;
- let the existing pause controller stop animations while the window is hidden, minimized, or unfocused;
- render no `codicon-modifier-spin` for a working or stalled session;
- apply the same finite treatment to the project-summary sync arrows, which were the two remaining permanent rotations seen after the first restart.

### First restart observation

With five active leases after restart, a 15-second sample measured the renderer at 51.5% CPU average (24.4–128.9%) and the GPU helper at 15.5% average (6.4–20.7%). This is lower than the earlier baseline, but the workloads are not identical, so it is evidence of progress rather than a controlled before/after result. The renderer remained materially busy, which supports continuing to Step 2.

### Acceptance criteria

- Running and stalled sessions remain clearly distinguishable from idle sessions.
- Sidebar rows and tab leads contain no infinite spinner.
- Settled sessions contain no live pulse.
- Existing needs-input, unread, background, and draft states are unchanged.
- With many active sessions but no streamed deltas, the renderer and GPU helper can sleep between five-second pulses.

## Step 2 — Make streaming-tail replacement O(1)

**Status:** implemented; production dogfood pending.

### Problem

Every stream flush first scans the full message array and then maps the full array to replace the item identified by `streamId`. Long sessions multiply this work across concurrent streams.

### Change

Introduce a tested immutable tail-update helper:

1. Fast path: when the last message ID matches `streamId`, copy the array once and replace only the final element.
2. Recovery path: if the stream is not the tail, find its index once and replace that element.
3. Seed path: append a new streaming message when the ID is absent.
4. Preserve object and array identity when the transform is a no-op.

Do not assume the stream is always last without retaining the recovery path; interim boundaries and tool segments can change message shape.

The helper now takes the O(1) tail path for normal token flushes, performs one reverse scan for unusual non-tail streams, appends absent streams, and preserves the existing array when an updater returns the existing message. The full `use-message-stream` suite covers the integration path.

### Acceptance criteria

- Exact existing stream behavior remains covered: seed, append, reasoning replacement, tool updates, interruption, interim boundaries, and completion.
- The common tail path does not execute `Array.prototype.some` or `Array.prototype.map` across history.
- The multitab performance scenario shows lower renderer self-time as transcript depth increases.

## Step 3 — Reduce visible Markdown reparse cost

**Status:** pending Step 2.

### Problem

The open Markdown block grows throughout a streamed answer. Streamdown reparses and rerenders that growing block on each visible flush; code fences are the worst case.

### Proposed investigation and change

- Capture a production CDP CPU profile for prose and fenced-code streams separately.
- Confirm whether parse, syntax highlighting, or React reconciliation dominates.
- Keep settled blocks memoized and isolate only the unfinished tail.
- Consider a lower visual update cadence for expensive unfinished blocks while preserving immediate terminal-state flushes.
- Never delay storage or gateway ingestion merely to reduce paint cadence.

### Acceptance criteria

- Input, resize, and scroll remain responsive during a long fenced-code stream.
- Final content is byte-identical and appears immediately when the turn settles.
- Hidden tabs continue to catch up in one commit when revealed.

## Step 4 — Attribute and eliminate retained renderer memory

**Status:** pending production heap evidence.

### Problem

The installed renderer reached roughly 2.5 GiB RSS. The current evidence establishes suspicious retention but does not identify the retaining object graph.

### Proposed investigation

1. Launch an isolated production renderer with the performance probe.
2. Record heap snapshots at clean boot, after loading eight realistic sessions, after closing them, and after forced garbage collection.
3. Compare retained paths for:
   - `$sessionStates` and runtime/stored-ID caches;
   - hidden-pane `useMessagesWhileVisible` state;
   - assistant-ui message repositories;
   - Shiki highlighter and rendered-code caches;
   - generated image/object URLs;
   - activity timer registries;
   - pane registrations and closed-tab fibers.
4. Fix only the proven owner. Do not indiscriminately clear caches that preserve fast session switching or live background work.

### Acceptance criteria

- Closing a session tab releases its transcript/render tree after garbage collection unless that session is still actively running.
- Repeated open/close cycles reach a stable memory plateau.
- Active background sessions remain resumable and continue receiving state correctly.

## Step 5 — Revisit global background unthrottling

**Status:** pending earlier fixes.

### Problem

`stream-throttle.ts` unthrottles every registered chat window whenever any renderer reports active work. This guarantees streamed updates are not stranded, but it also lets unrelated animation and timer work run at full cadence in every chat window.

### Proposed direction

Evaluate per-window activity accounting or split ingestion cadence from paint cadence. A minimized/background window must continue ingesting and finalizing deltas, but it does not necessarily need full compositor cadence throughout the turn.

### Acceptance criteria

- Background and minimized turns never stall or dump their whole answer only on refocus.
- Windows with no local active turn retain Chromium's default throttling.
- Multi-window tests cover one busy window plus one idle window.

## Operational mitigation until all steps land

- Stop or finish unnecessary concurrent turns.
- Close unused long-session tabs rather than keeping every session mounted.
- Restart Hermes when renderer RSS remains unusually high after work settles.
- Do not disable hardware acceleration as a default workaround; it can transfer compositor work to the CPU without fixing the update loop.

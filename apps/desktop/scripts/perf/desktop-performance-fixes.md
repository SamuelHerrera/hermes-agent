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
- use a full 0.75rem Codicon outline circle rather than freezing the open `loading` arc or substituting a heavier CSS border ring;
- briefly pulse the glyph once every five seconds;
- synchronize all status pulses through one scheduler;
- let the existing pause controller stop animations while the window is hidden, minimized, or unfocused;
- render no `codicon-modifier-spin` for a working or stalled session;
- apply the same finite treatment to the project-summary sync arrows, which were the two remaining permanent rotations seen after the first restart.

### First restart observation

With five active leases after restart, a 15-second sample measured the renderer at 51.5% CPU average (24.4–128.9%) and the GPU helper at 15.5% average (6.4–20.7%). This is lower than the earlier baseline, but the workloads are not identical, so it is evidence of progress rather than a controlled before/after result. The renderer remained materially busy, which supports continuing to Step 2.

### Current-build controlled validation

A fresh isolated production build was sampled for 20 seconds per condition with 12 indicators. The final full outline circle and its five-second finite pulse were measured separately from the old infinite loading rotation:

| Indicator state | GPU-process CPU | Renderer CPU |
|---|---:|---:|
| Static full circles, before | 0.44% | 0.08% |
| Infinite loading rotation | 9.13% | 6.71% |
| Static full circles, after | 1.06% | 0.50% |
| Full circles with finite pulse | 1.64% | 0.85% |

The finite pulse used about 82% less GPU-process CPU and 87% less renderer CPU than permanent rotation in this controlled run. Its average overhead over the immediately preceding static control was 0.58 and 0.35 percentage points respectively. This confirms that retaining a complete circle while eliminating infinite rotation is worthwhile; the earlier stationary open-arc glyph was only a visual regression and had no performance justification.

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

## Step 2b — Pause animation work in inactive kept-alive panes

**Status:** implemented and validated in a packaged-app/runtime production build.

### Problem

Inactive tabs remain mounted under `visibility: hidden` to preserve layout and scroll state. Their JavaScript glyph spinners already subscribe to `PaneVisibleContext`, but CSS animations continue advancing below the canonical `data-pane-hidden` marker. This includes live transcript shimmer effects in every hidden running session.

Two isolated production measurements established the cost:

- 12 visible shimmer labels used 13.55–17.31% GPU-process CPU and 12.46–19.53% renderer CPU, versus roughly 0.2–0.6% GPU-process and 0.03–0.41% renderer CPU in adjacent static controls.
- Merely hiding the same 12 shimmers with `visibility: hidden` reduced paint/compositor cost but still used 4.54% renderer CPU, versus 0.11% in the preceding static control.

### Change

Pause CSS animation timelines for descendants of `data-pane-hidden`. The pane stays mounted and keeps its dimensions exactly as before; removing the marker when the tab becomes active resumes its animations. Visible-pane animation behavior is unchanged.

### Acceptance criteria

- Packaged-app computed styles report `animation-play-state: paused` below a hidden pane and `running` for the same visible animation.
- Hidden-pane animation CPU returns near the static control in the isolated production probe.
- Switching back to a kept-alive tab restores its visible animation normally.

The packaged-app behavior test passed. In the post-change isolated probe, 12 hidden shimmer labels fell from the pre-change 4.54% renderer average (3.8% median) to 0.87% average (0.1% median); the one 10% sample was a transient at condition setup. GPU-process CPU was 0.77% average, close to the adjacent 0.56% and 0.53% static controls. Visible animations are deliberately unaffected.

## Step 2c — Bound visible shimmer animations

**Status:** implemented; packaged production dogfood pending.

### Problem

After restarting the hidden-pane build with five active leases, the installed renderer still averaged 44.99% CPU and the GPU process averaged 38.12% CPU over 20 seconds while a visible turn was active. The normal and 200-turn synthetic Markdown streams remained within one slow frame over their 10.8-second windows, so replacing Markdown rendering before addressing the known infinite visible animation cost would not follow the strongest evidence.

`tw-shimmer` animates text background position forever. Live tool titles, tool summaries, reasoning labels, delegation activity, artifacts, the Agents pane, and pet-generation status all used the unbounded class. A 15-second isolated production comparison with 12 labels measured:

| Shimmer state | GPU-process CPU avg / median | Renderer CPU avg / median |
|---|---:|---:|
| Static before | 0.23% / 0.2% | 0.05% / 0.0% |
| Infinite shimmer | 16.00% / 16.1% | 17.08% / 14.7% |
| One finite shimmer sweep | 3.32% / 0.7% | 4.47% / 0.2% |
| Static after | 1.73% / 1.1% | 1.34% / 0.4% |

The finite run includes its initial visible sweep; after that sweep, median process CPU returned close to the static controls instead of remaining continuously elevated.

### Change

Add a shared `ShimmerPulse` primitive that preserves the same shimmer appearance but forces one iteration with a stable finished state. A meaningful `pulseKey` remounts the span and replays one sweep when activity text changes. Route every application shimmer call site through the bounded primitive. Existing glyph spinners, elapsed timers, progress bars, and changing labels continue to communicate liveness after the sweep completes.

### Acceptance criteria

- No application status uses the raw infinite `shimmer` class directly.
- A shimmer performs one sweep, then its animation timeline finishes.
- New activity can replay one sweep by changing `pulseKey`.
- Caller classes and visual color variants remain intact.
- Renderer/GPU-process CPU can return near static levels between visible activity changes.

## Step 3 — Reduce visible Markdown reparse cost

**Status:** implemented; packaged production dogfood pending.

### Problem

The open Markdown block grows throughout a streamed answer. Existing tail repair, incremental block splitting, and deferred Shiki work already prevent several full-history costs, but Streamdown still parses and reconciles the current growing block at the transport flush cadence. A source-mapped development CPU profile attributed the dominant JavaScript self-time to Micromark tokenization (`create-tokenizer.js`), with additional Markdown preprocessing and artifact-detection scans.

### Change

Keep the transport/store path unchanged and cap only the rendered Markdown cadence for a small append to a running message larger than 8 KiB. The visible surface coalesces to the latest text every 66 ms; ordinary short streams remain immediate. Final content, non-append rewrites, and catch-up jumps larger than 4 KiB bypass the buffer so completion and a tab revealed after background work appear immediately.

The perf driver now accepts an initial prefix so an open fenced-code stream can be compared with identical growing prose. In a three-run interleaved production A/B using the same 600-token TypeScript fence and 33 ms transport flush:

| Mode | DOM mutations median | Renderer JS self-time median |
|---|---:|---:|
| Unbounded visible cadence | 295 | 840.6 ms |
| 66 ms visible cadence after 8 KiB | 178 | 444.0 ms |

That is 39.7% fewer DOM mutations and 47.2% less renderer JavaScript self-time. Both modes had zero frames over 33 ms and frame p95 at or below 16.9 ms in the interleaved run, so the reduced parse cadence did not introduce measurable stalls. Earlier non-interleaved frame samples varied with system load and are not used for the conclusion.

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

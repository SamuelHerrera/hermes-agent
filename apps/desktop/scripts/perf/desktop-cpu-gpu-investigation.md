# Hermes Desktop CPU/GPU Investigation

## Summary

Hermes Desktop has a real performance problem under the observed multi-session workload. The load is not explained by Electron's process model alone:

- the renderer main thread can stay continuously busy while several sessions stream;
- every working session paints a continuously rotating status ring in both the sidebar and tab strip;
- the renderer retains substantially more memory than the persisted transcript payload justifies.

The backend's CPU is separate and expected while agents are executing. The Desktop-specific problems are concentrated in the Electron renderer and GPU helper.

## User-visible symptom

Activity Monitor showed:

- `Hermes Helper (Renderer)` at about 91.5% CPU;
- `Hermes Helper` at about 19.4% CPU and 13.9% GPU;
- `WindowServer` at about 41.4% CPU and 26.1% GPU;
- the Python backend at about 32.7% CPU.

On macOS, 100% CPU means one fully occupied logical core. Renderer values above 100% indicate work spread onto renderer/raster worker threads in addition to the main UI thread.

## Live measurements

A 12-second sample of the installed application produced:

| Process | Average CPU | Peak CPU | Average RSS |
|---|---:|---:|---:|
| Electron renderer | 117.3% | 239.5% | 2,512.9 MiB |
| Electron GPU helper | 22.6% | 24.3% | 109.2 MiB |
| Electron main | 2.7% | 10.5% | 202.5 MiB |
| Hermes Python backend | 33.7% | 84.3% | 512.8 MiB |

A later point sample varied to 24.4% renderer CPU and 38.3% GPU-helper CPU, with the renderer still using about 1.4 GiB RSS. This variation tracks active streaming and paint activity; it is not a fixed launch-time cost.

## Workload at the time

The Desktop accessibility tree showed eight working sessions represented in both the sidebar and the tab strip. Shortly afterward, six sessions still had valid backend turn leases. The largest active sessions had approximately:

| Session | Messages | Tool calls | Cumulative tokens |
|---|---:|---:|---:|
| Assess new GitHub PRs for merging | 1,028 | 566 | 3,887,343 |
| Diagnose YjsBackendDoc update loop | 811 | 450 | 1,684,919 |
| Analyze eligibility/routing failures | 581 | 320 | 1,645,339 |
| Check shared forms and styles | 183 | 97 | 1,850,644 |

The cumulative token figures are API accounting rather than renderer payload size, but the message counts accurately describe the long, tool-heavy transcripts being updated concurrently.

## Renderer profile

A five-second native sample of the renderer recorded 3,850 samples for the main thread. The main thread was executing in all 3,850 samples rather than sleeping in the run loop. The compositor thread was mostly asleep (3,697 of 3,850 samples), which means the primary CPU bottleneck was renderer/JavaScript work rather than the compositor thread itself.

The production Electron bundle does not preserve enough JavaScript symbols for `sample` to attribute native stack frames to individual React functions, so source-level attribution was established with code tracing and isolated A/B probes.

## Source trace: concurrent stream processing

`src/app/session/hooks/use-message-stream/index.ts` batches deltas, but every flush still performs history-sized work for each streaming session:

- line 107 searches the complete message array for the current stream ID;
- lines 119–127 map and copy the complete array to replace the streaming message;
- lines 235–328 schedule flushes with a 33 ms minimum cadence and an adaptive ceiling;
- the comments at lines 246–264 document that each visible flush causes a React commit and a growing Streamdown Markdown reparse.

The hidden-transcript optimization in `src/app/chat/index.ts:184-205` correctly unsubscribes hidden panes from `$messages`, so every hidden tab is not repainting its complete transcript. However, all live sessions still receive state updates, history arrays are copied, and keep-alive panes retain their last message state.

This explains why renderer CPU scales with the number and depth of concurrently streaming sessions, while only the visible transcript pays the full React/Markdown rendering cost.

## Source trace and A/B proof: status animations

Working and stalled sessions used `Codicon` with `spinning`, which applies the infinite `codicon-modifier-spin` animation:

- `src/app/chat/session-status-dot.tsx:47-63`
- `src/app/chat/session-status-dot.tsx:158-180`
- `src/components/ui/codicon.tsx:12-18`

Each top-level session was represented in both the sidebar and tab strip, producing roughly two infinite loading animations per active session.

An isolated Hermes renderer was measured with the exact Codicon CSS class:

| Isolated state | GPU-process CPU | Renderer CPU |
|---|---:|---:|
| Static application | 0.3% | 0.1% |
| 12 infinite Codicon spinners | 9.5% | 5.0% |
| Spinners removed | 0.4% | 0.1% |

The codebase already contains `StatusPulse`, whose finite, synchronized animation explicitly exists so the renderer and compositor can sleep between pulses. Using an infinite CSS spinner for session status bypassed that optimization.

## Ruled-out hypothesis: backdrop image

The default backdrop uses a large, low-opacity image with `mix-blend-difference`, so it was tested as a possible full-window compositing multiplier. A 33 ms paint probe was compared with and without the backdrop in an isolated renderer. Removing the backdrop did not reduce process CPU. It is therefore not the primary cause and should not be disabled as the first mitigation.

## Memory concern

The production renderer reached about 2.5 GiB RSS even though the persisted active-message payload for the relevant sessions was only a few MiB. Some amplification is expected from decoded images, React fibers, parsed Markdown, syntax highlighting, V8 object overhead, and compositor surfaces, but this ratio is still suspicious.

A synthetic eight-tab, 40-turn workload also raised an isolated development renderer from roughly 133 MiB to roughly 770 MiB after the test surface was removed; forced garbage collection only reduced it to roughly 647 MiB. Because that run used a development renderer and CPU profiling, it is evidence of retention risk rather than proof of a specific production leak. A production heap snapshot is required before changing cache lifetimes.

## Conclusion

There are two proven Desktop costs:

1. concurrent stream updates and visible Markdown rendering can saturate the renderer main thread;
2. infinite session-status spinners prevent the GPU process and renderer from sleeping.

There is also a credible but not yet object-attributed memory-retention problem. Fixes should be shipped and measured one at a time so CPU/GPU improvements are not confused with the later stream and memory work.

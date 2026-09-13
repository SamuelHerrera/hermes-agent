# State checkpoint progress and integration contract

## Outcome

The lifetime replay cap is removed. `Screen` retains the live headless terminal, a UTF8 decoder and a sequence counter, not an output transcript. Every attach captures current state at its queued write-callback boundary. The delivery ring remains independent and byte-bounded; a gap can always request a new supported checkpoint.

This is an experimental **pinned, output-driven terminal profile**, not a universal promise for every addon, renderer side effect or arbitrary private-core mutation. There is no `exact:true` flag. Unsupported runtime/profile/state shapes fail explicitly without terminating the host or silently using ANSI serialization.

## Consumer API

Browser-compatible package export: `@hermes/terminal-host/xterm-state-v1`.

- `initializeTerminalState(term)`: install the presentation ledger **before the first write** if this terminal will be a capture source. `Screen` does this automatically. Do not initialize late and infer that earlier colors were tracked.
- `assertCompatibleTerminal(term)`: require the audited runtime and stock synchronous handler/Unicode profile, compatible field types and no pending write. All parser addons are rejected. Run after awaiting a write callback's Promise, not reentrantly inside the callback.
- `captureTerminalState(term, {seq})`: synchronously capture JSON-safe, whitelisted state. The caller must serialize writes/resizes around this operation. This is automatic in `Screen.snapshot()`.
- `hydrateTerminalState(term, checkpoint)`: validate the full envelope and destination before mutation. Prefer a fresh terminal; browser terminals **must be opened first**, in a hidden but measurable container with xterm CSS. No ANSI is written. Populates real line/attribute factories, activates the appropriate buffer before filling it, creates real hyperlink markers/subscriptions, restores services/input, applies presentation, then restores parser continuation last and refreshes rows.
- `restoreScreen` in the Node-only `./screen` entrypoint is an async wrapper around hydration.

`format='hermes-xterm-state'`, `version=1` and `engine` identify the checkpoint. The old `data`, `initial`, `replay`, `exact` fields are absent. Optional `preview:{approximate:true,data}` is for diagnostics only. Never use it as a reconstruction stream.

After hydration, apply only events with `seq > checkpoint.seq`, await each write callback, and apply ordered resize events before the next output. On `GAP`, obtain another attach/checkpoint and a fresh mirror; do not recreate the PTY. Retain the host epoch and terminal ID. Native pending UTF8 bytes are host-owned and intentionally not in a renderer checkpoint. This is not host-crash recovery.

## Whitelisted state

- Both buffers: packed typed cell content/fg/bg, combined strings, raw extended attrs (not the URL-modified `ext` getter), wrapping, cursor including pending-wrap `x===cols`, ybase/ydisp, margins, tabs, saved cursor/attrs/charset.
- Current attrs; title/icon and stacks; string-decoder surrogate interim and xterm UTF8-decoder interim.
- Core/DEC modes, cursor hidden/initialized, mouse protocol **and encoding**, charset slots/active selection; pinned stock Unicode version 6.
- Escape parser current state, collect, preceding join state; all Params arrays and continuation/rejection flags. OSC/DCS active handler identity, accumulated data, hit-limit state and DCS Params are rebound to fresh destination handlers. Paused asynchronous handlers are rejected.
- Link IDs/data and each marker's buffer/line ownership. Disposal uses the stock link-service removal callbacks, so alternate exits and scrollback trimming clean up metadata.
- OSC palette/default foreground/background/cursor SET/RESTORE ledger, preserving reset-to-local-theme behavior. Current title notification is emitted on hydration.

Validation supports terminal geometry up to 1000, scrollback up to 100000, stock Windows PTY option fields and optional title push/pop window options. Host RPC geometry remains 2..500 and host scrollback is 2000. These geometry/profile constraints are not output-volume limits. Combining strings, retained links and in-progress payloads remain state-sized and are not silently truncated.

## Runtime audit

Pinned dependencies: headless 6.0.0; renderer 6.0.0 (test dependency); serializer 0.14.0 (preview only); Playwright 1.58.2 (test dependency).

`test/xterm-audit.test.mjs` compares the installed sourcemaps: **43 xterm common sources plus 11 VS Code common helpers match byte-for-byte**. Combined SHA256:

`6d8b8ca070207e3fe6bf8e70f63adb02c874325ff4bbd7d8bca2faed421fbd19`

Runtime constructor/handler registry fingerprints are `fd3f8048` (CJS headless) and `289f5647` (UMD browser). These are compatibility sentinels, not cryptographic authentication. A transformed/minified Desktop bundle must not bypass the guard: ship the audited UMD asset unchanged or repeat the source/runtime audit and real browser continuation suite for that exact build before authorizing it.

## TDD and executed evidence

Each implementation slice followed an observed failure before its fix:

1. A 4,320,000-byte btop-style repaint stream failed the original implementation with `RECONSTRUCTION_LIMIT`. Repeated fresh restore and subsequent output now agree with an uninterrupted terminal; checkpoint sizes were **12,599 / 12,607 / 12,615 / 12,623 bytes**, including preview and sequence metadata. The small increase is retained normal-buffer text, not replay history.
2. Partial escape continuation failed at split 1 (`ESC` alone), then passed after parser/services restoration.
3. Hyperlink maps were empty after restoration, then passed after marker-aware restoration and scrollback/alternate cleanup.
4. Opened browser colors differed (`#cc0000/#ffffff` versus `#123456/#abcdef`), then passed with the color ledger. Device replies are suppressed during subsequent mirror output.
5. Corrupt/runtime-drift/addon snapshots were accepted, then failed before mutation after validation. Untracked presentation, unopened renderers and pending writes now explicitly reject.
6. UTF8 decoder state advanced before the queue boundary, then passed after moving decoding inside the queue.
7. ANSI preview appeared under reconstruction `data`, then moved to an explicitly approximate `preview` object.
8. Oversized single-event delivery retention lacked a strict byte bound; the independently tested `DeliveryRing` now evicts it and reports GAP, including when the ring becomes empty.
9. The packed browser-safe export was unavailable, then passed after adding the package export.

Regression/continuation coverage includes **380 character-boundary cases in real headless terminals and 380 in isolated, opened Chromium xterm terminals with xterm CSS**. Browser tests compare full adapter state, DOM row text after continuation/resize, initial hydrated row text, and actual theme colors. Vectors include both buffers, saved cursor, margins/origin, pending wrap, charset, CSI subparams, split OSC/DCS/ST, surrogate pairs/combining/REP, hyperlinks, color resets, title push/pop (explicitly enabled), synchronized-output mode, protected cells, tabs and mouse/paste modes. Other tests exercise resize/reflow before checkpoints, UTF8 host byte splits, Params rejection/capacity and OSC payloads just below/above the stock 10,000,000-code-unit limit.

Intentional growth is tested: combining cells reach 10,001 / 20,001 / 30,001 characters, and 1,000 links on an otherwise empty line survive hydration. This is evidence **against** advertising a universal fixed byte cap.

Real macOS btop reattachment retained PID **11604** in the full run; two independently hydrated snapshots plus intervening host deltas agreed. Real detached host/PTYS, scope/auth/epoch/lease behavior, host query answers, GAP, and packed-install CLI/PTYS remain covered.

Commands from `packages/terminal-host`:

```sh
npm ci --workspaces=false
# Browser binary was already available in this environment; on a new test machine:
node node_modules/playwright/cli.js install chromium
npm test --workspaces=false
node --test test/checkpoint.test.mjs test/browser-checkpoint.test.mjs
node --test test/xterm-audit.test.mjs
node --test test/package.test.mjs
node --check src/xterm-state-v1.mjs
node --check src/xterm-state-validation.mjs
git diff --check
```

Full executed run: **37 tests, 36 pass, 1 native-Windows ACL skip, 0 failures**. Local TAP evidence is under ignored `artifacts/checkpoints-full.tap`, `browser-green.tap`, `parser-red.tap`, `validation-green.tap`, `ring-green.tap` and other slice logs.

Dependency setup note: an initial npm invocation omitted `--workspaces=false` and hoisted dependencies into this feature worktree's root. The root lockfile was restored immediately and dependencies were reinstalled package-locally with `--workspaces=false`; native helper permissions were restored with the existing `node src/prepare-native.mjs`. No root lock change is included, no live-tree dependency installation occurred, and the final package test installs into a disposable prefix. The first browser fixture omitted UTF8 in its JavaScript Content-Type, corrupting literal DEC charset glyphs; fixing the fixture encoding resolved that test-only discrepancy.

## Remaining gates / limits

- No Desktop integration, deployed rebuild, backend restart test, service installation, push or production change. Native Linux/Windows execution, ConPTY and Windows launcher Job Object lifetime are unexecuted gates.
- Only the pinned stock synchronous parser/Unicode profile is accepted. Graphics/image addons, custom parser handlers, decorations and external application state are not captured. Source terminals must be output-driven; terminal UI selection, viewport interaction history, DOM pixels, animation/timer phase and local theme defaults are not canonical host state.
- The mirror guard allows events marked user input and drops non-user `coreService.triggerDataEvent` calls. It deliberately does **not** provide a complete physical mouse/focus integration. That routing needs review before Desktop release; do not blindly forward emitter output to PTY input.
- Headless has no browser theme consumer and does not answer OSC color-report queries. SET/RESTORE fidelity is tested; defining a host base theme/report policy is a separate feature.
- No universal fixed-size guarantee, process resurrection, disk checkpoint durability or arbitrary addon compatibility is claimed. Unsupported state must produce an actionable error while the live PTY keeps running.

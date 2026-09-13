# Terminal host progress

Worktree: `/Users/samuelherrerafuente/Work/HYP/hermes-persistent-terminal-host`, branch `feat/persistent-terminal-host`, base `aa1c8eee82`. Sole implementation writer; no live repo edits or app/service restarts.

## Implemented so far

- Standalone `packages/terminal-host`, exact pins node-pty 1.1.0, @xterm/headless 6.0.0, @xterm/addon-serialize 0.14.0. Package-local lock/deps, no shared node_modules writes.
- Detached CLI start/status/stop with explicit runtime `--dir`, host lock, strong loopback auth, scope/session registry, idempotency, writer generation, explicit detach vs terminate.
- `connect(directory).request(method, params)` API; HTTP JSON POST /rpc, bearer token endpoint file, epoch validation. Node/Python consumers can implement same protocol; integrations not written.
- Headless screen callback queue, snapshot sequence + ordered read deltas, host-only DSR responses, streaming UTF8 decoding, serialized visual snapshot and bounded exact replay.
- **Fidelity gate:** serializer alone does NOT restore arbitrary parser/mode state. Exact replay (including resize history) capped at 2 MiB; after limit `exact:false`, replay null, `restoreScreen` refuses `RECONSTRUCTION_LIMIT`. Serialized visual snapshot remains available but is NOT exact continuation. This needs a stronger bounded checkpoint strategy before unrestricted TUI release.
- Runtime security POSIX 0700/0600 with owner/mode checks; native Windows private DACL branch included, NOT executed here.

## RED → GREEN evidence

Each tracer was written/run RED before its implementation, then run GREEN:
1. Creator client process exit + reattach shell PID/non-exported variable: missing CLI → real PTY GREEN. Discovered node-pty Darwin spawn-helper tarball mode 0644; package postinstall fixes package-local helper executable bit. Observed `posix_spawnp failed` before fix.
2. Idempotent scoped create through termination: unequal IDs/PIDs → GREEN.
3. Stale writer input/disconnect: missing rejection → GREEN.
4. Normal/alternate serializer + differential alternate exit: missing Screen → GREEN.
5. Partial ANSI, UTF8, origin/scroll modes and resize exact replay: missing exact flag → GREEN.
6. Bounded replay honesty: true vs false → GREEN.
7. Real PTY device reply + snapshot/delta ordering: timed out without host DSR response → GREEN.
8. Safe stop + concurrent start singleton: missing live-session refusal → GREEN.
9. Auth/origin/rebinding/epoch: HTTP 200 vs 403 → GREEN. Node fetch ignores custom Host; rebinding test now uses real node:http request.
10. Private directory: missing module → POSIX GREEN; Windows ACL test skipped on macOS.
11. Slow-reader ring GAP: missing rejection after 800KB output → GREEN.
12. Invalid protocol dimensions/scope/input: missing rejection → GREEN.
13. Natural exit status/final output: NOT_FOUND instead of exit metadata → GREEN.
14. npm pack → isolated npm install → installed CLI/PTYS: missing --version → GREEN.

## Final verification and integration handoff

- `npm test --workspaces=false`: **22 tests, 21 pass, 0 fail, 1 native Windows ACL skip** on macOS/Node v22.22.3. Real same-shell proof reported PID **66820**, retained local variable `retained42`; host epoch `bf7d0c7a-c18e-486e-894c-d285f4b4c4f7`.
- Real btop acceptance: PID **67028** survived detach and a separate reconnecting client; continued detached output, alternate-screen snapshot sequence **44**. Uses a temporary btop config, no user app restart.
- Isolated tarball installation and PTY creation passed; installed npm `.bin/hermes-terminal-host --version` also exercised (focused package test passed after adding direct bin invocation).
- Subsequent RED/GREEN tracers covered PTY ignoring SIGHUP (changed explicit termination to SIGKILL on POSIX), registry admission, transport body cap/protocol version, PTY queue peak watermark, initial dimensions, UTF8 JSON split chunks, and admission closure during stop. The intentionally hangup-ignoring process from RED was identified by its exact test command and explicitly killed; no intentionally retained test processes.
- Root `package-lock.json` regenerated with `npm install --package-lock-only --ignore-scripts --workspace packages/terminal-host --no-audit --no-fund`: only 30 additive lines (workspace entry/link and @xterm/headless). No root dependency install or shared node_modules changes.
- Artifact (git-ignored): `packages/terminal-host/artifacts/hermes-terminal-host-0.1.0.tgz`; SHA256 **305fc14f3fa1e0e2a412493074c5d166ff20b52705ec0804fdbde78ae04b79ae**. Exact TAP output retained beside it at `artifacts/test-output.tap`.
- Public contract: `packages/terminal-host/README.md`; implementation `src/{client,host,screen,protocol,security,cli,prepare-native}.mjs`; five `test/*.test.mjs` files. Both package-local and root locks committed.
- Scope enforcement assumes a trusted same-user token holder; future backend derives scope server-side. Renderer must route physical input separately and suppress generated device replies during restore AND live playback.
- **Remaining gates:** exact continuation after 2MiB replay budget; native Windows ACL/ConPTY/launcher Job Object survival; native Linux; Node/native-binary bundling, immutable install/service manager, Desktop/backend adapters and actual app-restart acceptance. Current package requires installed platform-compatible Node. No service installs, production deploys, Python/Desktop code changes or push.

Scoped commit follows focused tests and `git diff --check`. Parent should treat this as an experimental core, not unrestricted persistent-TUI release readiness.

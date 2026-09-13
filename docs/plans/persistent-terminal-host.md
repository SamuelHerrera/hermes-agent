# Independent persistent terminal host implementation plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Keep the same interactive terminal process alive when Desktop and the agent backend quit/restart, with a host bundled with Desktop and installable for backend-only use on macOS, Linux and native Windows.

**Architecture:** A separate per-user Node process owns node-pty sessions and headless xterm screen state. Desktop connects locally and remote backends proxy authenticated connections. Neither client owns host lifetime; explicit terminate ends a terminal, disconnect only detaches.

**Tech stack:** Node, node-pty, matching xterm headless/browser major versions, local IPC, existing Electron and Python backend integration.

## Contract and limits

- Existing UI tab identity/focus/history restoration is retained. Manual tab hide behavior is unchanged; explicit sidebar deletion terminates.
- Persistent identity includes connection, profile scope, host epoch, terminal ID. Attach never silently respawns a missing process. Cold restoration of legacy tabs without persistent IDs may create a new shell once.
- Host runs as current OS user. Local endpoint must be private and authenticated; Windows ACL/user isolation must be explicit, not inferred from a random pipe name. Remote access goes through existing backend auth/origin checks; no public host listener.
- Stable session identity, idempotent create, one writer lease with stale-disconnect guards. Process exit is distinguishable from transport disconnect.
- Host owns headless screen and terminal query responses. Snapshot and subsequent deltas use an atomic ordered boundary. Restore alternate and normal buffers without injecting Ctrl-L or running prior commands.
- Memory bounded per terminal/client; slow clients detach, never block PTY draining. No automatic killing of detached active work.
- Upgrade artifacts live in immutable versioned user directories outside replaceable Desktop bundles. Upgrading Desktop/backend must not restart an active host. Stop/uninstall refuses live terminals unless explicit destructive force is requested.
- Reboot, host crash, logout/service stop are not process persistence. Missing sessions show ended/lost, with explicit new-session action.

## Task 1: Host protocol and same-process detach/reattach tracer

Files: create `packages/terminal-host/package.json`, `src/protocol.mjs`, `src/host.mjs`, `src/client.mjs`, `test/host.test.mjs`; update workspace lock only for exact needed dependencies.

1. Write real subprocess test that creates shell, records PID and shell-local variable, disconnects client, reconnects from a separate process, and checks same PID/variable. Run and record RED.
2. Add authenticated private local endpoint, session registry, request correlation, create/attach/input/resize/detach/terminate operations. Host must outlive creator exit.
3. Run GREEN. Add one test at a time for wrong auth/scope, duplicate create, stale attachment, process exit, explicit termination and concurrent startup.
4. Do not require a globally installed Node for bundled artifacts. Development tests may use the available Node runtime and identify that limitation.

## Task 2: Screen reconstruction and backpressure

Files: create `packages/terminal-host/src/screen.mjs`, `test/screen.test.mjs`; modify host session code.

1. RED test normal and alternate screen reconstruction plus subsequent differential output after reconnect, split escape sequences, Unicode, resize and alternate-screen exit.
2. Integrate pinned `@xterm/headless` matching renderer xterm and serialization. Inspect serializer gaps; do not claim arbitrary terminal fidelity from snapshot text alone. Preserve required mode state; parser boundary and post-restore behavior are release gates.
3. Host alone answers PTY device queries; replay/device replies from renderer cannot be interpreted as input. Sequence snapshot before deltas; bound slow-client queues.
4. GREEN tests and real btop smoke if available, with a separate reconnecting client.

## Task 3: Package and lifecycle

Files: create host CLI/install scripts and tests, `hermes_cli/terminal_host.py`; modify CLI routing and Desktop native staging/packaging at inspected seams.

1. RED tests packaged entrypoint, artifact discovery, immutable user install, singleton negotiation, no forced active-host upgrade, safe stop/uninstall.
2. Provide install/start/status/stop/uninstall with documented per-user ownership. Prefer existing launchd/systemd-user/Windows scheduled-task patterns, without installing production services during development.
3. Stage Node-targeted native binaries separately from Electron ABI and preserve executable helpers. Standalone artifact and Desktop bundle use identical host payload.
4. Test native macOS package smoke. Add Linux/Windows CI matrix and mark native executions unverified until run. Never call mocked platform branches cross-platform proof.

## Task 4: Desktop integration

Files: `apps/desktop/electron/terminal-host-client.ts`, `main.ts`, `preload.ts`, bridge types; `src/app/right-sidebar/terminal/terminals.ts`, `use-terminal-session.ts`, ownership/lifecycle tests.

1. RED test persisted terminal opens by attach rather than start, teardown only detaches, explicit deletion terminates, unavailable host/session cannot silently start a replacement.
2. Replace local PTY owner with host adapter retaining existing bridge shape where possible. Persist identity immediately after create before async output delivery.
3. Separate live host snapshot from legacy reviveBuffer and prompt trimming. Input and resize require current writer attachment.
4. Preserve shell choice/env, cwd, process title, profile ownership and pane focus. No scope fallback to foreground local machine.
5. Run targeted UI/Electron tests and typecheck.

## Task 5: Backend and remote routing

Files: `hermes_cli/terminal_host.py`, `hermes_cli/web_server.py`, `apps/desktop/electron/remote-terminal.ts`, remote routing tests.

1. RED integration test authenticated backend proxy create -> disconnect -> backend restart -> reattach same host session/PID.
2. Versioned terminal protocol with explicit detach/exit, capabilities and IDs. Existing auth/host/origin/peer validation stays in place. Backend derives owner scope.
3. Legacy remote capability is clearly nonpersistent or fails closed; never silently retarget to local terminal.
4. SSH transport must connect to host on remote machine; do not equate keeping a local ssh PTY alive with remote survival. Explicitly gate unsupported route.

## Task 6: Reviews and delivery

1. Spec review then independent code quality/security review; correct blockers and re-review.
2. Run real host and client lifecycle tests in isolated temporary homes. Record actual commands, outputs and any native OS access blockers.
3. Inspect full diff and source drift before scoped commit. Merge only validated feature, preserving unrelated main changes.
4. Package/deploy macOS only after release gates. Do not quit live Desktop; user reopens it for same-btop-PID final acceptance. Do not claim Linux/Windows acceptance until native tests execute.

## Verification commands

Host: `node --test packages/terminal-host/test/*.test.mjs` (adjust if package-local install needed).
Desktop: `npm run test --workspace apps/desktop -- --project electron <targeted-test-files>`; UI equivalent `--project ui`; `npm run typecheck --workspace apps/desktop`.
Backend: `.venv/bin/python -m pytest <targeted-terminal-host-and-web-terminal-tests> -q` using isolated homes.
Review: `git diff --check`, scoped diffs, tested commit/artifact hashes.

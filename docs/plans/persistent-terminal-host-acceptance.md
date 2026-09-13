# Persistent terminal delivery and acceptance

## Implemented

- Independent Node/node-pty host, private authenticated loopback RPC, scoped durable identities and writer leases.
- Current-state-sized xterm checkpoints and bounded deltas, including rejection of undersized buffer lines before destination mutation.
- Desktop main-process attachment, identity persistence, checkpoint hydration, disconnect retry without implicit shell recreation, detach on application shutdown, explicit termination on sidebar removal (including unopened restored terminals).
- Authenticated Python backend proxy with server-derived owner scope and environment. Host tokens remain server-side.
- Native Desktop staging includes checksum-verified Node and node-pty. The host executes from an immutable version directory outside the replaceable app bundle.
- Brand-new tabs may use the legacy backend transport when no persistent greeting is available; the terminal displays a persistence warning. Restored persistent identities never fall back to a new shell.

## Backend-only bundle

On the target native platform, run `node apps/desktop/scripts/stage-terminal-host.mjs` from the repository. The result is `apps/desktop/dist/terminal-host/`.

From the extracted bundle, run:

```sh
./node package/src/cli.mjs install --dir "$HOME/.hermes/terminal-host"
./node package/src/cli.mjs status --dir "$HOME/.hermes/terminal-host/runtime"
# Explicit destructive stop, only when all owned terminal work may end:
./node package/src/cli.mjs stop --force --dir "$HOME/.hermes/terminal-host/runtime"
```

On Windows use `node.exe` and the corresponding user-profile path. For a named backend profile use that profile's Hermes home. `install` copies the runtime/package into a versioned directory and starts independently; it does not register an OS boot service. Existing active host versions remain running until explicitly stopped. Do not remove their files while they are active.

## Executed acceptance

- macOS native host: 59 passed, one Windows-only skip.
- Linux HP native host: 59 passed, one Windows-only skip; included opened Chromium continuation tests. Test package/browser lived in a disposable directory that was removed afterward; no production service was changed.
- Desktop Electron: complete quit/reopen retained shell PID 49380, non-exported value `survived`, and foreground btop PID 50176. Reopened screenshot showed btop; pressing q returned to the original shell and the value remained intact.
- Backend: real uvicorn process termination/restart on the same port preserved the host epoch, shell PID and non-exported shell state. Authenticated WebSocket and legacy transport regression lane: 21 passed.
- Store/routing unit lane: 24 passed. Desktop typecheck/build exercised separately.

These receipts are test executions, not claims that the installed app or remote production backend was deployed.

## Limits and release gates

- Native Windows ConPTY, endpoint ACL and launcher Job Object lifetime have not been exercised; do not claim Windows acceptance.
- Exact checkpoints target the audited stock xterm 6 / Unicode-6 profile. Presentation-only addons are activated separately; custom parser providers and Unicode-11 checkpoints are not supported. Agent terminal mirrors retain their existing separate implementation.
- No survival across reboot, logout, host crash, or explicit host termination is promised. Stale locks are not automatically stolen.
- Desktop reopen acceptance selects the restored terminal tab; it proves process/screen continuation, not automatic focus restoration.
- Production deployment and native Windows acceptance are separate from the isolated build receipt.

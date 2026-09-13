# @hermes/terminal-host (experimental core)

An independent Node process owns PTYs and headless xterm state. Clients do not own its lifetime. This package has **no Electron or Python dependency** and does not integrate with Desktop/backend yet.

## Install and lifecycle

Requires Node >=22.22.0 and native node-pty support (ConPTY on native Windows). Dependencies are pinned. A platform-compatible Node runtime is required; this slice does not bundle one.

From this directory:

```sh
npm ci --workspaces=false
npm test --workspaces=false
npm pack --workspaces=false
# Install the produced tarball into a NEW, private, version-specific prefix:
npm install --prefix /private/path/terminal-host-0.1.0 --workspaces=false ./hermes-terminal-host-0.1.0.tgz
node /private/path/terminal-host-0.1.0/node_modules/@hermes/terminal-host/src/cli.mjs start --dir /private/path/terminal-runtime
```

Use Windows user-profile paths on Windows. `hermes-terminal-host` is also exported as an npm bin. Commands:

- `--version`
- `start --dir PATH`: detached process with ignored stdio; waits for authenticated status. Reuses a running host (including during concurrent starts) instead of replacing it. Node must not be inside a parent-owned kill-on-close Windows Job Object; this deployment gate needs native Windows verification.
- `status --dir PATH`: protocol version, epoch, host PID, active session count, peak per-PTY queued bytes. Never prints the token.
- `stop --dir PATH`: refuses `LIVE_SESSIONS` even when every client has detached.
- `stop --dir PATH --force`: destructive; kills owned PTY jobs (SIGKILL to POSIX job-control groups; `taskkill /T /F` plus ConPTY cleanup on Windows), closes admission, acknowledges shutdown, then removes owned discovery/lock and exits. The acknowledgment precedes final process exit by a short cleanup grace. A termination error returns `TERMINATION_FAILED` and leaves the host available for cleanup retry.

The core **never auto-exits**. Even empty hosts require explicit stop. It never kills active detached work because of idle time or client disconnect. `serve --dir PATH` is an internal foreground entrypoint; integrations should use `start`.

This is the bounded core lifecycle, not an OS-service installer. Install/uninstall use npm. Before uninstalling, explicitly stop and verify the host PID has exited, then `npm uninstall --prefix PREFIX @hermes/terminal-host`. Do not upgrade/remove an active host's prefix; install the next version beside it and retain old files until its host is stopped. No launchd/systemd/task-scheduler registration or automatic upgrade migration is implemented.

`host.lock` is an exclusive directory. A crash intentionally leaves it behind: **no automatic lock stealing or PID-based killing**. If status is unreachable, verify the old host is gone and explicitly remove the stale `host.lock` and `endpoint.json` before starting again. Do not remove these merely because a status request timed out. Reboot, logout, host crash, OS service/job termination and killing an ancestor-owned Windows Job are not process persistence. Detached descendants that escaped the PTY are not guaranteed terminated.

## Security boundary

Listener binds **127.0.0.1 only**, random port, with a 256-bit random bearer token. Only `POST /rpc` is accepted. All Origin headers and Sec-Fetch-Site headers are rejected; Host must exactly equal `127.0.0.1:PORT`. No CORS, browser-direct access, network bind option or query-string credentials.

`--dir` must be a dedicated, private directory under a trusted private parent (not a network filesystem). POSIX checks current owner, refuses symlinks and group/other permissions, creates directory 0700 and discovery file 0600. Windows replaces the directory DACL with an inheritable current-SID-only FullControl rule before token publication; PowerShell ACL failure aborts startup. **Native Windows ACL behavior is test-ready but not validated on macOS.** Administrator/root and processes already running as the same user are trusted; the token grants shell execution as that user.

`scope` prevents accidental cross-profile/connection attachment; it is **not separate authorization for holders of the same host token**. Future backend adapters MUST derive scope from authenticated server-side identity, never trust browser-supplied scope, and never give the host token to a renderer. Host status/stop are user-wide administrative operations. Remote access must go through a separately authenticated backend or SSH tunnel, not expose this port.

## Node client API

```js
import { connect } from '@hermes/terminal-host';
const client = await connect(runtimeDirectory);
const created = await client.request('create', {
  scope: 'connection-id/profile-id', requestId: crypto.randomUUID(),
  file: '/bin/sh', args: ['-i'], cwd: '/desired/cwd', cols: 100, rows: 30,
});
// Persist {scope, terminalId, epoch} immediately. Never recreate on attach failure.
const attached = await client.request('attach', {
  scope: 'connection-id/profile-id', terminalId: created.terminalId, epoch: created.epoch,
});
// Restore attached.snapshot before processing events with seq > snapshot.seq.
await client.request('input', { ...attached.identity, data: 'pwd\r' });
const updates = await client.request('read', { ...attached.identity, after: attached.snapshot.seq });
await client.request('detach', attached.identity); // shell remains alive
// Explicit deletion only:
await client.request('terminate', attached.identity);
```

`connect` reads discovery once, pins the epoch/token, and offers `epoch` plus async `request(method, params)`. It does not reconnect, respawn, retry mutations or infer fallback scopes. Errors have matching `message` and `code`. Network failure remains a transport error; do not reinterpret it as process exit. After rediscovery, pass the **persisted** epoch to attach to distinguish old state from the new host.

Shell choice is explicit (`file`, `args`). On Windows use `powershell.exe` or `cmd.exe` with appropriate args. The shell inherits the host's environment; custom per-session environment is not yet exposed. Default dimensions 80x24; accepted range 2..500. Max input 64 KiB; create requires nonempty scope and requestId.

## Wire protocol v1 (also implementable in Python)

Read private `endpoint.json`: `{port, epoch, token}`. Send HTTP/1.1 JSON:

```
POST http://127.0.0.1:PORT/rpc
Authorization: Bearer TOKEN
Content-Type: application/json

{"epoch":"HOST_EPOCH","method":"attach","params":{"scope":"SCOPE","terminalId":"ID","epoch":"PERSISTED_EPOCH"}}
```

One response per request provides correlation: `{"result": ...}` or HTTP 400/403 `{"error":"CODE"}`. Use a fresh HTTP request/connection for each call; no SSE/WebSocket or RPC id is required. UTF8 JSON may be chunked. 128 KiB body limit, 32 connections, one request per socket, bounded request/response timeouts.

| Method | Params beyond scope | Result |
|---|---|---|
| status | none; scope not required | protocol, epoch, pid, sessions, maxQueuedBytes |
| create | requestId, file, optional args/cwd/cols/rows | terminalId, pid, epoch |
| list | none | active `sessions:[{terminalId,pid}]` for scope |
| attach | terminalId, persisted epoch recommended | pid, snapshot, identity:{terminalId,scope,generation,epoch} |
| input | identity + data | {} |
| resize | identity + cols, rows | {} (ordered resize delta) |
| detach | identity | {}; invalidates writer, does not kill |
| read | terminalId + after sequence | events, exit:null or node-pty exitCode/signal |
| terminate | terminalId | {}; explicit scoped admin kill, not writer-dependent |
| stop | optional force boolean; no scope | stopped:true |

Create deduplicates `(scope,requestId)` for the host epoch, including after exit; changed arguments with an old requestId still return the original creation result. 64 active sessions and 10,000 creation records maximum; no eviction that could accidentally respawn an old request. UUID IDs are never reused. Attach only finds live sessions; `NOT_FOUND` never creates. Most recent 64 exits retain final bounded output/status; older exits become `NOT_FOUND`.

Each successful attach increments a writer generation. Input, resize and detach reject stale generations (`STALE_WRITER`); read is non-owning. Writer operations are ordered per terminal, never across the whole host. There is no writer timeout to mistake an idle connection for a dead process. Disconnected/expired requests are checked before dispatch and after asynchronous barriers, so an abandoned attach cannot acquire a lease later. Disconnect alone does not terminate the PTY.

Admission is bounded to eight pending writer RPCs per terminal and 24 across the host (`QUEUE_FULL`); status, read, terminate and stop bypass those queues. Screen operations have a four-second watchdog. Rejected output/exit work or a stalled screen transitions only that terminal to `SCREEN_FAILED`, aborts its leases and attempts owned-job cleanup. `read` retains the failure and native exit when available. Ordinary checkpoint validation errors are returned without killing or recreating the terminal. This contains asynchronous stalls, not an arbitrary synchronous JavaScript event-loop hang.

Startup rolls back its listener and owned lock on listen/publication failure; it does not steal an existing lock or delete preexisting artifacts. Discovery is published by atomic rename of a fresh exclusive file, never by overwriting a potentially permissive inode. Windows independently replaces and verifies that file's protected current-SID-only DACL before writing the token; explicit ACEs on an old endpoint are not inherited. Cleanup checks artifact identity before removal.

POSIX termination anchors ownership to the live original leader's PID, parent, UID, start time and native PTY name. It covers ordinary inherited-stdio descendants and foreground/background groups on that PTY, killing the leader group last. It does not scan unrelated jobs or promise cleanup of daemons that establish a different session/controlling terminal. Native Linux and Windows lifecycle/ACL execution remain release gates; macOS tests do not certify those platforms.

Other errors: `HOST_LOST`, `SCOPE_MISMATCH`, `INVALID_PARAMS`, `SESSION_LIMIT`, `CREATE_LIMIT`, `GAP`, `LIVE_SESSIONS`, `STOPPING`, `REQUEST_TOO_LARGE`, `FORBIDDEN`, `UNKNOWN_METHOD`. Native spawn errors are returned as messages; clients should not depend on their text.

## Screen contract and honest fidelity gate

Host uses @xterm/headless **6.0.0**, matching renderer xterm **6.0.0**, and serializer 0.14.0. It incrementally decodes UTF8 and preserves parser state across chunks. PTY output is recorded only **after xterm's write callback**. Snapshot is a serialized operation in the same queue; its `seq` is the exact boundary before subsequent deltas. Resize events share this sequence. Poll `read(after)` without gaps, apply events in sequence, advance only after terminal write callbacks. A slow reader gets `GAP` once its cursor falls outside the 256 KiB ring: reattach for a new snapshot, never silently concatenate a partial stream. PTY parsing has its own pause/resume watermarks; renderer speed never blocks draining.

Snapshots now use **state-sized checkpoints**, not lifetime replay. There is no 2 MiB output-history failure threshold. Storage depends on current buffers, parser payloads and metadata, independently of historical output volume. This is **not a universal fixed byte bound**: stock xterm permits growing combining strings and hyperlink metadata. Nothing is silently truncated.

The envelope has `format: "hermes-xterm-state"`, `version: 1`, an audited `engine` fingerprint, `seq`, dimensions, semantic options, both buffers, input/parser/charset/core/mouse state, links and presentation. **`data`, `initial`, `exact`, and `replay` are removed.** Optional `preview: {approximate:true,data}` is inspection-only ANSI; never write it into a reconstruction terminal. The helper does not claim universal exactness via a boolean.

```js
// Browser-safe: this entrypoint has no Node/Electron dependencies.
import { hydrateTerminalState } from '@hermes/terminal-host/xterm-state-v1';
const mirror = new Terminal({ allowProposedApi: true }); // audited xterm 6.0.0 build
mirror.open(hiddenContainer);                            // REQUIRED before hydration
hydrateTerminalState(mirror, attached.snapshot);         // synchronous; no ANSI replay
// Expose mirror, then apply events with seq > snapshot.seq, in order.
```

Node callers can also `await restoreScreen(term, snapshot)` from `@hermes/terminal-host/screen`. Prefer a **fresh destination**. Both package builds and handler profiles are pinned; incompatible runtimes, parser addons, pending writes and malformed field shapes fail before destination mutation. A minifying/rebundling change can alter runtime fingerprints: ship the audited UMD renderer unchanged as an asset, or audit and test the new build before adding its fingerprint. Do not disable the guard to make a Desktop build pass.

The adapter copies whitelisted data into genuine xterm factories/prototypes. It restores parser continuation last, including complete Params storage/flags, partial OSC/DCS handler payloads bound to the destination's own handlers, and split string/UTF8 decoder state. Hyperlinks have real buffer-marker disposal subscriptions. A color-override ledger is installed on the host before its first write; browser hydration applies overrides/reset-to-local-theme semantics after open, refreshes rows and publishes the current title. `StringDecoder.write()` is inside the Screen queue; pending host UTF8 bytes stay host-owned, **not copied into mirrors**.

**Host alone answers device queries.** Hydration installs a mirror guard dropping non-user `coreService.triggerDataEvent` output during restoration and later playback. Keyboard/paste events marked as user input still work. Integrators must not bypass this guard or blindly forward raw renderer emitters. Automatic mouse/focus reporting is deliberately not an input integration in this slice; mouse protocol/encoding state is preserved, but a separately reviewed physical mouse/focus route remains a Desktop gate. Stock headless does not answer OSC color-report requests (the ledger tracks SET/RESTORE, not a host base theme). No Ctrl-L, synthetic redraw commands, previous user input or serializer reconstruction is injected into the PTY.

The 256 KiB delivery ring is separately byte-bounded, including oversized single events. `GAP` means obtain a fresh checkpoint; it never makes the live terminal permanently unrestorable. Invalid/unsupported checkpoint errors must leave the live host session running, not trigger recreation. See [CHECKPOINTS.md](CHECKPOINTS.md) for the supported envelope, evidence and remaining gates.

## Verification

`npm test --workspaces=false` runs real detached hosts, real PTYs, independent client subprocesses, natural exit and explicit cleanup, scope/auth/origin/epoch/lease cases, flood/GAP, screen differential tests, and `npm pack` → isolated npm install → installed CLI + PTY. Optional POSIX btop acceptance uses its own temporary config and reconnecting client.

macOS executed: real headless differential tests, 380 continuation cases in an isolated opened Playwright Chromium/xterm renderer (with CSS and DOM verification), real btop reattachment/hydration, and packaged CLI/PTYs. Native Linux and Windows (including ConPTY, DACL inheritance, detached lifetime under launcher job objects, npm executable behavior and native helper staging) remain **unexecuted release gates**. No Desktop/backend restart integration or production deployment is claimed. Browser tests require the pinned Playwright Chromium installed (`node node_modules/playwright/cli.js install chromium`); they fail rather than silently skip when it is unavailable.

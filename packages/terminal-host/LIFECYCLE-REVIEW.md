# Lifecycle/security review fixes

Base: `27388665f0e21590bf1a0beea415fb552fc7bc2f` (state-checkpoint implementation).
Branch: `feat/persistent-terminal-host`. No Desktop/backend integration or deployment.

## Findings and regression evidence

| Finding | Fix | Executed regression |
|---|---|---|
| Leader-only termination leaves descendants | Identity-checked POSIX PTY job groups; native Windows tree termination path | Real ordinary inherited-stdio child, hangup-ignoring foreground/background jobs, terminate and force-stop; unrelated sentinel survives |
| Global RPC chain blocks host | Per-terminal writer ordering, bounded admission, independent admin RPCs, screen watchdog | Injected stalled snapshot in a real host; another PTY, status, terminate and stop remain available; ninth request gets QUEUE_FULL |
| Abandoned async operation can mutate later | Cancellation checks before dispatch and after barriers; resize checks inside the screen queue | Abort a real HTTP attach, release its delayed snapshot, verify the next successful attach gets generation 1 and PTY remains alive |
| Rejected screen work crashes host | Explicit rejection handling and session-local failed state | Inject write/exit queue rejection while a second real PTY remains usable; failure retained by read |
| Startup failure leaks listener and lock | Listener rollback and identity-bound owned-lock cleanup | Real endpoint-directory publication failure exits itself; real EADDRINUSE releases lock; preexisting artifacts/lock preserved |
| Existing endpoint may retain permissive ACL | Exclusive fresh file, independent verified Windows DACL, atomic rename | On macOS, permissive old inode/open handle remains unchanged and new discovery is private; Windows explicit Everyone ACE replacement assertion is included but unexecuted |
| Failed force-stop wedges admission | Attempt cleanup for all sessions, restore admission on termination failure | Inject process-query failure; host stays discoverable and a restored cleanup attempt succeeds |

The lifecycle, stalled-host, abandoned-attach, admission, write/exit rejection, startup and permissive-inode regressions were observed red before their respective fixes. Full-suite packaging exposed an additional startup race: the native fork helper can still report `?` as its controlling terminal when stop arrives. The fix permits only the anchored leader group during this interval, never all `?` processes. The isolated package test subsequently passed.

## Final local verification

On macOS, `npm test --workspaces=false` from this package: **54 tests, 53 passed, 0 failed, 1 skipped**. The skipped test is the native Windows directory-ACL test. The suite includes real detached hosts/PTYs, checkpoint differential and opened-browser continuation coverage, btop reattachment, and `npm pack` → isolated install → installed CLI/PTY smoke.

The pinned checkpoint adapters, schema, hydration implementation and checkpoint/browser tests are unchanged. `screen.mjs` only adds the optional queued resize cancellation check; checkpoint capture/restore behavior remains intact.

## Unexecuted gates and limits

- Native Windows tree termination, explicit foreign-ACE replacement, actual access denial from a foreign identity, launcher Job Objects and native packaging still require Windows execution. Current Windows assertions inspect ACLs; they do not establish a real foreign-account access-denial result.
- Native Linux job control and packaging require Linux execution.
- POSIX ownership checks deliberately fail closed if the original live leader identity no longer matches. Escaped/reparented daemons outside the owned controlling terminal are not promised cleanup. Enumeration and signaling are not a kernel-atomic process-container primitive.
- The watchdog contains unresolved asynchronous screen operations, not a synchronous event-loop hang.
- A screen fault can terminate the affected PTY; a client disconnect by itself does not. Ordinary unsupported-checkpoint errors remain request errors, not a recreation/termination trigger.

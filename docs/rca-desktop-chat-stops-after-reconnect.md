# RCA: Desktop chat stops after a backend restart or reconnect

**Status:** resolved by `fix(desktop): resume chats across backend restarts`
**Severity:** P1 — an active chat can appear frozen mid-task with no final response or visible recovery.

## Summary

Hermes Desktop could stop showing progress after its always-on backend restarted or its WebSocket reconnected. The most visible case was a session tile that restarted the backend while it was still working: the transcript ended after a tool result, the task list remained incomplete, and the composer became available even though the requested work had not concluded.

Two independent recovery gaps combined:

1. The backend removed the durable interrupted-turn marker from `_run_prompt_submit()`'s unconditional `finally` path, even when no terminal `message.complete` frame reached the client.
2. A Desktop session tile trusted its cached runtime ID after reconnect. It republished cached state without calling `session.activate`, so the new WebSocket never received that runtime's events. After a backend restart, where runtime IDs are re-minted, it also failed to fall through to a durable `session.resume`.

Either gap could make a chat look stopped. Together they prevented both live-event reattachment and crash auto-continuation.

## Incident evidence

The confirming incident was stored session `20260831_152215_f29ccb` (`Verify backend install button behavior`) on August 31, 2026.

- The last persisted turn contained a tool call that started the local backend restart and its tool result, but no final assistant response.
- `~/.hermes/logs/agent.log` showed context compression starting immediately after that tool result, then WebSocket close code `1012`, followed by a new backend process startup.
- `~/.hermes/logs/desktop.log` showed the session tile restoring against cached runtime state rather than completing the interrupted task.
- `~/.hermes/desktop/interrupted_turns.json` no longer contained the session even though no terminal response had been delivered.
- `session_turn_leases` in `~/.hermes/state.db` still contained the expired lease, confirming that the old turn had been interrupted rather than cleanly completed.

## Root cause and fix

### 1. Preserve the crash marker until a terminal frame

**Code:** `tui_gateway/server.py`

Terminal response paths already call `_retire_turn_marker()` immediately before emitting `message.complete`. The unconditional marker retirement in `_run_prompt_submit()`'s `finally` block was therefore both redundant and incorrect: `finally` also runs during process shutdown before the client receives a terminal frame.

The fix removes that backstop. A successful or handled-error path still retires the marker next to `message.complete`; a shutdown path without a terminal frame leaves it behind. The next cold `session.resume` can then call `_maybe_schedule_auto_continue()` and finish the interrupted request, subject to the existing freshness, lease, and crash-loop guards.

**Regression test:** `tests/tui_gateway/test_auto_continue.py::test_process_shutdown_before_terminal_frame_keeps_marker`

### 2. Rebind session tiles to the current backend connection

**Code:**

- `apps/desktop/src/app/chat/session-tile.tsx`
- `apps/desktop/src/app/contrib/hooks/use-session-tile-delegate.ts`

On a closed-to-open gateway transition, a mounted session tile now asks its delegate to resume even when it still has a cached runtime ID.

The delegate applies an ordered recovery ladder:

1. Call `session.activate` for the cached runtime so the backend attaches event fanout to the current WebSocket.
2. If activation succeeds, reconcile running/settled state and refresh persisted messages.
3. If activation reports `Session not found` or the runtime belongs to another stored session, evict the stale binding.
4. Fall through to profile-aware `session.resume`, which creates a fresh runtime and can schedule interrupted-turn auto-continuation.
5. Preserve the old compatibility behavior only when the backend genuinely lacks `session.activate`.

**Regression tests:**

- `use-session-tile-delegate.test.ts`: cached runtime reactivation and state reconciliation
- `use-session-tile-delegate.test.ts`: stale runtime eviction followed by cold resume

## If the symptom returns

Capture the stored session ID and incident time first, then correlate these sources:

1. **Backend turn log:** `~/.hermes/logs/agent.log`
   - Find the session ID.
   - Identify the last model/tool event.
   - Look for `ws closed`, backend startup, `auto-continue scheduled`, or a provider/tool exception.
2. **Desktop UAT log:** `~/.hermes/logs/desktop.log`
   - Search the same stored session ID.
   - Inspect `session-tile.patch`, `session-tiles.saved`, `route-resume.*`, and gateway reconnect events.
3. **Durable crash marker:** `~/.hermes/desktop/interrupted_turns.json`
   - If no terminal response was delivered, a fresh entry should remain until resume claims it.
4. **Durable lease:** `~/.hermes/state.db`, table `session_turn_leases`
   - A non-expired lease means another backend still owns the turn; auto-continue must not duplicate it.
   - An expired lease plus a fresh marker should permit continuation.
5. **Persisted transcript:** `~/.hermes/state.db`, tables `sessions` and `messages`
   - Verify whether a final assistant message exists or the transcript ends after a tool result.

Useful commands:

```bash
# Backend lifecycle and turn evidence
rg 'SESSION_ID|auto-continue|ws (closed|accepted)' ~/.hermes/logs/agent.log

# Desktop restore/rebind evidence
rg 'SESSION_ID|session-tile|route-resume' ~/.hermes/logs/desktop.log

# Marker inspection
python3 -m json.tool ~/.hermes/desktop/interrupted_turns.json

# Lease inspection (replace SESSION_ID)
sqlite3 ~/.hermes/state.db \
  "select conversation_id, holder, acquired_at, expires_at from session_turn_leases where conversation_id='SESSION_ID';"
```

Interpretation:

- **Fresh marker, no live lease, but no `auto-continue scheduled`:** inspect the cold `session.resume` path and auto-continue config/freshness guards.
- **Live runtime but no new tile events after reconnect:** inspect the `session.activate` call and `SessionFanoutTransport` attachment.
- **Stale runtime returns `Session not found` but no cold resume follows:** inspect `resumeTile()`'s stale-binding eviction and profile resolution.
- **Marker disappears without `message.complete`:** inspect every `_retire_turn_marker()` call; retirement must stay adjacent to a terminal frame.
- **Transcript contains a terminal assistant response but the UI still looks busy:** inspect Desktop state reconciliation/watchdog logic rather than auto-continue.

## Verification

Run the focused contract tests and Desktop static checks:

```bash
scripts/run_tests.sh \
  tests/tui_gateway/test_auto_continue.py \
  tests/tui_gateway/test_failed_turn_retention.py \
  tests/tui_gateway/test_protocol.py \
  tests/tui_gateway/test_session_resume_db_ownership.py \
  tests/tui_gateway/test_session_db_ownership_teardown.py

cd apps/desktop
npx vitest run src/app/contrib/hooks/use-session-tile-delegate.test.ts
npm run typecheck
npx eslint \
  src/app/chat/session-tile.tsx \
  src/app/contrib/hooks/use-session-tile-delegate.ts \
  src/app/contrib/hooks/use-session-tile-delegate.test.ts
```

A live deployment check should additionally prove that the always-on backend PID changes, `/api/health` returns HTTP 200, Desktop reconnects, and an interrupted tiled chat either reattaches to the live runtime or auto-continues through a newly resumed runtime.

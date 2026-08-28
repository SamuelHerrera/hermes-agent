"""Per-thread interrupt signaling for all tools.

Provides thread-scoped interrupt tracking so that interrupting one agent
session does not kill tools running in other sessions.  This is critical
in the gateway where multiple agents run concurrently in the same process.

The agent stores its execution thread ID at the start of run_conversation()
and passes it to set_interrupt()/clear_interrupt().  Tools call
is_interrupted() which checks the CURRENT thread — no argument needed.

Usage in tools:
    from tools.interrupt import is_interrupted
    if is_interrupted():
        return {"output": "[interrupted]", "returncode": 130}
"""

import logging
import os
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Generic, TypeVar

logger = logging.getLogger(__name__)

# Opt-in debug tracing — pairs with HERMES_DEBUG_INTERRUPT in
# tools/environments/base.py.  Enables per-call logging of set/check so the
# caller thread, target thread, and current state are visible when
# diagnosing "interrupt signaled but tool never saw it" reports.
_DEBUG_INTERRUPT = bool(os.getenv("HERMES_DEBUG_INTERRUPT"))

if _DEBUG_INTERRUPT:
    # AIAgent's quiet_mode path forces `tools` logger to ERROR on CLI startup.
    # Force our own logger back to INFO so the trace is visible in agent.log.
    logger.setLevel(logging.INFO)

# Set of thread idents that have been interrupted.
_interrupted_threads: set[int] = set()
_interrupt_epochs: dict[int, int] = {}
_lock = threading.RLock()
_start_locks: dict[int, threading.RLock] = {}
_T = TypeVar("_T")


@dataclass(frozen=True)
class StartResult(Generic[_T]):
    """Outcome of an interrupt-linearized irreversible start."""

    started: bool
    value: _T | None = None
    interrupted_during_start: bool = False


def _start_lock_for(tid: int) -> threading.RLock:
    """Return the per-execution lock that orders Stop with irreversible starts."""
    with _lock:
        return _start_locks.setdefault(tid, threading.RLock())


def set_interrupt(active: bool, thread_id: int | None = None) -> None:
    """Set or clear interrupt for a specific thread.

    Args:
        active: True to signal interrupt, False to clear it.
        thread_id: Target thread ident.  When None, targets the
                   current thread (backward compat for CLI/tests).
    """
    tid = thread_id if thread_id is not None else threading.current_thread().ident
    assert tid is not None
    start_lock = _start_lock_for(tid)
    with start_lock:
        with _lock:
            if active:
                _interrupted_threads.add(tid)
                _interrupt_epochs[tid] = _interrupt_epochs.get(tid, 0) + 1
            else:
                _interrupted_threads.discard(tid)
            _snapshot = set(_interrupted_threads) if _DEBUG_INTERRUPT else None
    if _DEBUG_INTERRUPT:
        logger.info(
            "[interrupt-debug] set_interrupt(active=%s, target_tid=%s) "
            "called_from_tid=%s current_set=%s",
            active, tid, threading.current_thread().ident, _snapshot,
        )


def is_interrupted() -> bool:
    """Check if an interrupt has been requested for the current thread.

    Safe to call from any thread — each thread only sees its own
    interrupt state.
    """
    tid = threading.current_thread().ident
    with _lock:
        return tid in _interrupted_threads


def commit_if_not_interrupted(
    commit: Callable[[], None],
    rollback: Callable[[], None] | None = None,
    finalize: Callable[[], None] | None = None,
) -> bool:
    """Run an approval commit atomically with interrupt publication.

    A concurrent ``set_interrupt(True, tid)`` either wins first, in which case
    the callback is not run, or waits until the callback has committed. A
    re-entrant interrupt published by the reversible commit path itself is
    detected by its epoch and rolled back before failure is returned. Once that
    check passes, ``finalize`` is the transaction's irreversible seal: an
    interrupt published during finalization is ordered after the approval and
    remains set for the executor to observe.
    """
    tid = threading.current_thread().ident
    assert tid is not None
    start_lock = _start_lock_for(tid)
    with start_lock:
        with _lock:
            if tid in _interrupted_threads:
                return False
            epoch = _interrupt_epochs.get(tid, 0)
        commit()
        with _lock:
            interrupted = (
                tid in _interrupted_threads
                or _interrupt_epochs.get(tid, 0) != epoch
            )
        if interrupted:
            if rollback is not None:
                rollback()
            return False
        if finalize is not None:
            finalize()
        return True


def start_if_not_interrupted(start: Callable[[], _T]) -> StartResult[_T]:
    """Start an irreversible effect atomically with interrupt publication.

    A concurrent ``set_interrupt(True, tid)`` either publishes before this
    function acquires the target execution's start lock and prevents the
    effect, or waits until the effect has crossed its physical start boundary.
    Per-target locking means a slow remote start never delays Stop for an
    unrelated session.
    Callers must keep
    ``start`` limited to that start operation (for example ``Popen``), never
    the full lifetime of the process, so Stop is delayed only until startup is
    linearized.

    A same-thread/re-entrant Stop cannot race the callback because it executes
    inside the same call stack. Its epoch is still reported so the caller can
    enter the normal post-start cancellation path.
    """
    tid = threading.current_thread().ident
    assert tid is not None
    start_lock = _start_lock_for(tid)
    with start_lock:
        with _lock:
            if tid in _interrupted_threads:
                return StartResult(started=False)
            epoch = _interrupt_epochs.get(tid, 0)
        value = start()
        with _lock:
            interrupted = (
                tid in _interrupted_threads
                or _interrupt_epochs.get(tid, 0) != epoch
            )
        return StartResult(
            started=True,
            value=value,
            interrupted_during_start=interrupted,
        )


def clear_current_thread_interrupt() -> None:
    """Clear any interrupt bit on the CURRENT thread.

    Used only by explicit force-confirmed terminal replays. Human approval does
    not clear Stop. Call this directly, never via the ``_interrupt_event`` proxy
    (its ``clear()`` binds to whichever thread invokes it).
    """
    set_interrupt(False)  # thread_id=None -> current thread (see set_interrupt)


# ---------------------------------------------------------------------------
# Backward-compatible _interrupt_event proxy
# ---------------------------------------------------------------------------
# Some legacy call sites (code_execution_tool, process_registry, tests)
# import _interrupt_event directly and call .is_set() / .set() / .clear().
# This shim maps those calls to the per-thread functions above so existing
# code keeps working while the underlying mechanism is thread-scoped.

class _ThreadAwareEventProxy:
    """Drop-in proxy that maps threading.Event methods to per-thread state."""

    def is_set(self) -> bool:
        return is_interrupted()

    def set(self) -> None:  # noqa: A003
        set_interrupt(True)

    def clear(self) -> None:
        set_interrupt(False)

    def wait(self, timeout: float | None = None) -> bool:
        """Not truly supported — returns current state immediately."""
        return self.is_set()


_interrupt_event = _ThreadAwareEventProxy()

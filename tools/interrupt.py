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


def set_interrupt(active: bool, thread_id: int | None = None) -> None:
    """Set or clear interrupt for a specific thread.

    Args:
        active: True to signal interrupt, False to clear it.
        thread_id: Target thread ident.  When None, targets the
                   current thread (backward compat for CLI/tests).
    """
    tid = thread_id if thread_id is not None else threading.current_thread().ident
    assert tid is not None
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
    with _lock:
        if tid in _interrupted_threads:
            return False
        epoch = _interrupt_epochs.get(tid, 0)
        commit()
        if tid in _interrupted_threads or _interrupt_epochs.get(tid, 0) != epoch:
            if rollback is not None:
                rollback()
            return False
        if finalize is not None:
            finalize()
        return True


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

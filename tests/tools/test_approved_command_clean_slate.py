"""Regression tests for approval and pre-execution interrupt handling.

Only an explicit ``force=True`` terminal replay clears a stale interrupt.
Human-approved terminal and execute_code work must retain a Stop that lands
after the approval commit and before process spawn.
"""
import json
import threading
import time

import pytest

from tools import terminal_tool as tt
from tools.interrupt import (
    set_interrupt,
    is_interrupted,
    _interrupted_threads,
    _lock,
)


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / "logs").mkdir(exist_ok=True)
    # Clean interrupt slate before and after every test so a stale tid left in
    # the module-global set can't leak across tests in the same worker.
    with _lock:
        _interrupted_threads.clear()
    yield
    with _lock:
        _interrupted_threads.clear()


def _wait_for_sentinel(sentinel, timeout=10.0):
    """Block until the running command created its sentinel (proving the
    clean-slate clear already ran and the command is in its poll loop)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if sentinel.exists():
            return True
        time.sleep(0.02)
    return sentinel.exists()


# ---------------------------------------------------------------------------
# terminal_tool
# ---------------------------------------------------------------------------

def test_approved_command_clears_stale_interrupt_bit():
    """force=True marks the run user-approved -> the stale bit is cleared and
    the command completes (exit 0), not killed with 130."""
    set_interrupt(True)  # simulate a bit that landed during the approval-wait
    assert is_interrupted()

    result = json.loads(tt.terminal_tool(command="sleep 0.5; echo DONE", force=True))

    assert result["exit_code"] == 0, result
    assert "DONE" in result["output"]
    assert "[Command interrupted]" not in result["output"]


def test_non_approved_command_still_interrupts_on_stale_bit(monkeypatch):
    """A command that is auto-approved but NOT user-approved keeps the current
    interrupt behavior: a pre-existing bit still kills it (DO-NOT-BREAK)."""
    monkeypatch.setattr(tt, "_check_all_guards", lambda *a, **k: {"approved": True})
    set_interrupt(True)

    result = json.loads(tt.terminal_tool(command="sleep 0.5; echo DONE"))

    assert result["exit_code"] == 130, result
    assert "[Command interrupted]" in result["output"]


def test_human_approved_command_does_not_clear_stop(monkeypatch):
    monkeypatch.setattr(
        tt,
        "_check_all_guards",
        lambda *a, **k: {
            "approved": True,
            "user_approved": True,
            "description": "dangerous",
        },
    )
    set_interrupt(True)

    result = json.loads(tt.terminal_tool(command="sleep 0.5; echo DONE"))

    assert result["exit_code"] == 130, result
    assert "DONE" not in result["output"]
    assert "[Command interrupted]" in result["output"]


@pytest.mark.parametrize("background", [False, True])
def test_stop_from_approval_handoff_prevents_immediate_terminal_effect(
    monkeypatch, tmp_path, background
):
    sentinel = tmp_path / f"must_not_exist_{background}"

    def approve_then_stop(*_args, **_kwargs):
        set_interrupt(True)
        return {
            "approved": True,
            "user_approved": True,
            "description": "dangerous",
        }

    monkeypatch.setattr(tt, "_check_all_guards", approve_then_stop)

    result = json.loads(tt.terminal_tool(
        command=f"touch {sentinel}",
        background=background,
    ))

    assert result["exit_code"] == 130, result
    assert result["status"] == "interrupted"
    assert not sentinel.exists(), "executor started after Stop won the handoff"


def test_approved_command_genuine_interrupt_after_start_still_kills(tmp_path):
    """The clean-slate clear must NOT make approved commands un-interruptible:
    an interrupt that arrives after execution starts still SIGINTs (130)."""
    sentinel = tmp_path / "cmd_started_c"
    holder = {}

    def worker():
        holder["result"] = tt.terminal_tool(
            command=f"touch {sentinel}; sleep 5; echo DONE", force=True
        )

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    # Barrier: the command is genuinely running (so the clear already ran) before
    # we fire the interrupt -- no fixed-sleep timing guess.
    assert _wait_for_sentinel(sentinel), "command did not start"
    set_interrupt(True, thread_id=t.ident)  # genuine interrupt, AFTER start
    t.join(timeout=15)
    assert not t.is_alive(), "worker did not exit after a genuine interrupt"

    result = json.loads(holder["result"])
    assert result["exit_code"] == 130, result
    assert "[Command interrupted]" in result["output"]
    set_interrupt(False, thread_id=t.ident)


def test_approved_note_enriched_not_misleading_on_interrupt(monkeypatch, tmp_path):
    """On a genuine post-start interrupt of an approved command, the note must
    read '...approved by the user, then interrupted.' — the bare
    '...approved by the user.' must never co-occur with exit 130."""
    monkeypatch.setattr(
        tt,
        "_check_all_guards",
        lambda *a, **k: {"approved": True, "user_approved": True, "description": "rm -rf x"},
    )
    sentinel = tmp_path / "cmd_started_d"
    holder = {}

    def worker():
        holder["result"] = tt.terminal_tool(command=f"touch {sentinel}; sleep 5; echo DONE")

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    assert _wait_for_sentinel(sentinel), "command did not start"
    set_interrupt(True, thread_id=t.ident)
    t.join(timeout=15)
    assert not t.is_alive()

    result = json.loads(holder["result"])
    assert result["exit_code"] == 130, result
    note = result.get("approval", "")
    assert note.endswith("then interrupted."), note
    assert "approved by the user, then interrupted." in note
    assert "approved by the user." not in note  # success-implying string is gone
    set_interrupt(False, thread_id=t.ident)


def test_natural_exit_130_not_mislabeled_as_interrupt(monkeypatch):
    """A command that legitimately exits 130 on its own (no interrupt) must NOT
    get its approval note rewritten to '...then interrupted.'."""
    monkeypatch.setattr(
        tt,
        "_check_all_guards",
        lambda *a, **k: {"approved": True, "user_approved": True, "description": "x"},
    )
    # Clean slate: no interrupt at all.
    result = json.loads(tt.terminal_tool(command="bash -c 'exit 130'"))

    assert result["exit_code"] == 130, result
    note = result.get("approval", "")
    assert note == "Command required approval (x) and was approved by the user.", note
    assert "then interrupted" not in note
    assert "[Command interrupted]" not in result["output"]


def test_retry_backoff_interrupt_prevents_next_attempt(monkeypatch):
    """A Stop during retry backoff must prevent another executor handoff."""
    from tools.environments.local import LocalEnvironment

    calls = {"n": 0}

    def fake_execute(self, command, **kw):
        if "sleep 1" not in command:  # ignore any incidental execute calls
            return {"output": "", "returncode": 0}
        calls["n"] += 1
        if calls["n"] == 1:
            set_interrupt(True)  # Stop lands during the first attempt / backoff
            raise RuntimeError("transient backend error")
        raise AssertionError("executor retried after Stop")

    monkeypatch.setattr(LocalEnvironment, "execute", fake_execute)
    monkeypatch.setattr("tools.terminal_tool.time.sleep", lambda *a, **k: None)
    set_interrupt(False)

    result = json.loads(tt.terminal_tool(command="sleep 1", force=True, task_id="retry-test"))

    assert calls["n"] == 1, calls
    assert result["exit_code"] == 130, result
    assert result["status"] == "interrupted"


# ---------------------------------------------------------------------------
# execute_code (same root cause, its own approval-wait + spawn/poll loop)
# ---------------------------------------------------------------------------

def test_execute_code_approved_does_not_clear_stop(monkeypatch):
    """A Stop after execute_code approval must survive until execution."""
    from tools.code_execution_tool import execute_code

    monkeypatch.setattr(
        "tools.approval.check_execute_code_guard",
        lambda *a, **k: {"approved": True, "user_approved": True},
    )
    set_interrupt(True)
    assert is_interrupted()

    result = json.loads(execute_code(
        code='import time; time.sleep(0.5); print("CODE_DONE")',
        task_id="test-clean-slate",
    ))

    assert result["status"] != "success", result
    assert "CODE_DONE" not in result["output"]


def test_stop_from_approval_handoff_prevents_immediate_execute_code_effect(
    monkeypatch, tmp_path
):
    from tools.code_execution_tool import execute_code

    sentinel = tmp_path / "execute_code_must_not_exist"

    def approve_then_stop(*_args, **_kwargs):
        set_interrupt(True)
        return {"approved": True, "user_approved": True}

    monkeypatch.setattr(
        "tools.approval.check_execute_code_guard",
        approve_then_stop,
    )

    result = json.loads(execute_code(
        code=f"from pathlib import Path; Path({str(sentinel)!r}).touch()",
        task_id="test-pre-spawn-stop",
    ))

    assert result["status"] == "interrupted", result
    assert result["exit_code"] == 130
    assert not sentinel.exists(), "execute_code child started after Stop won"


def test_execute_code_non_approved_still_interrupts_on_stale_bit(monkeypatch):
    """Non-user-approved execute_code keeps current interrupt behavior."""
    from tools.code_execution_tool import execute_code

    monkeypatch.setattr(
        "tools.approval.check_execute_code_guard",
        lambda *a, **k: {"approved": True},  # approved, but NOT user_approved
    )
    set_interrupt(True)

    result = json.loads(execute_code(
        code='import time; time.sleep(0.5); print("CODE_DONE")',
        task_id="test-clean-slate-2",
    ))

    # Killed on the first poll before the script can print.
    assert "CODE_DONE" not in result["output"], result



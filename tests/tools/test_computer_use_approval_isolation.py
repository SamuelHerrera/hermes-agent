"""Regression: leaked approval callbacks must not poison later tests.

``tools.computer_use.tool._approval_callback`` and the per-session unlock
stores are module-globals. Without the autouse reset fixture in
``tests/conftest.py``, a test that installs a callback and "forgets" it
changes the behavior of every later computer-use test in the process:
a raising callback becomes ``verdict = "deny"`` (dispatch tests see an
empty backend call list), a blocking callback hangs the run. The pair
below simulates the forgetful test and asserts the next test still sees
default-allow behavior.
"""

import json
import threading
import time
from pathlib import Path


def _install_backend(cu_tool):
    class _RecordingBackend:
        def __init__(self):
            self.calls = []

        def start(self):
            pass

        def stop(self):
            pass

        def is_available(self):
            return True

        def click(self, **kw):
            self.calls.append(("click", kw))
            from tools.computer_use.backend import ActionResult

            return ActionResult(ok=True, action="click")

        def capture(self, mode="som", app=None):
            from tools.computer_use.backend import CaptureResult

            return CaptureResult(
                mode=mode, width=1, height=1, png_b64=None, elements=[],
                app="X", window_title="",
            )

    backend = _RecordingBackend()
    cu_tool.reset_backend_for_tests()
    cu_tool._backend = backend
    return backend


def test_a_forgets_a_poisoned_approval_callback():
    """Simulates the polluter: installs a callback with the LEGACY
    two-argument signature and deliberately does not reset it."""
    from tools.computer_use import tool as cu_tool

    def stale_two_arg_callback(action, args):  # wrong arity on purpose
        return "approve_once"

    cu_tool.set_approval_callback(stale_two_arg_callback)
    # no reset — the autouse fixture must clean this up


def test_b_still_dispatches_with_default_allow():
    """Without the isolation fixture this fails: the stale callback raises
    (arity), ``_request_approval`` converts that into a deny, and the
    backend never sees the click."""
    from tools.computer_use import tool as cu_tool

    backend = _install_backend(cu_tool)
    result = cu_tool.handle_computer_use({"action": "click", "element": 3})
    call_names = [c[0] for c in backend.calls]
    assert "click" in call_names, (
        f"leaked approval callback poisoned this test: {result!r}"
    )
    payload = json.loads(result) if isinstance(result, str) else result
    assert not (isinstance(payload, dict) and payload.get("error"))


def test_kanban_worker_approval_waits_for_board_resolution(tmp_path, monkeypatch):
    from hermes_cli import kanban_db as kb
    from tools import approval as approval_mod
    from tools.computer_use import tool as cu_tool

    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    kb.init_db()
    conn = kb.connect()
    try:
        task_id = kb.create_task(conn, title="approval bridge", assignee="default")
    finally:
        conn.close()

    monkeypatch.setenv("HERMES_KANBAN_TASK", task_id)
    monkeypatch.setenv("HERMES_KANBAN_RUN_ID", "11")
    monkeypatch.setattr(cu_tool, "_approval_bypass_active", lambda _session_id: False)
    monkeypatch.setattr(approval_mod, "_get_approval_timeout", lambda: 5)

    result: dict[str, str | None] = {"value": None}

    def wait_for_approval():
        result["value"] = cu_tool._request_approval("click", {"action": "click", "element": 1}, "session-a")

    thread = threading.Thread(target=wait_for_approval)
    thread.start()
    approval_id = None
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        conn = kb.connect()
        try:
            pending = kb.list_approval_requests(conn)
            if pending:
                approval_id = pending[0].id
                kb.resolve_approval_request(conn, approval_id, "session")
                break
        finally:
            conn.close()
        time.sleep(0.05)

    assert approval_id is not None
    thread.join(timeout=3)
    assert not thread.is_alive()
    assert result["value"] is None

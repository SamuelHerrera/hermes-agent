"""Live request metadata, not renderer journals, owns prompt recovery."""
import threading

import pytest

from tui_gateway import server


@pytest.mark.parametrize("event", ["sudo.request", "secret.request", "clarify.request"])
def test_resolved_request_is_not_replayed_before_waiter_cleanup(monkeypatch, event):
    ev = threading.Event()
    monkeypatch.setattr(server, "_pending", {"request": ("owner", ev)})
    monkeypatch.setattr(server, "_answers", {})
    monkeypatch.setattr(server, "_pending_prompt_payloads", {"request": (event, {"request_id": "request"})})
    monkeypatch.setattr(server, "_emit", lambda *args: None)
    assert server._session_pending_prompt_snapshot("owner") is not None
    server._respond(1, {"request_id": "request", "value": "test-only"}, "value")
    assert server._session_pending_prompt_snapshot("owner") is None
    assert server._session_pending_kind("owner") == ""


@pytest.mark.parametrize("cancelled", [False, True])
def test_expired_or_cancelled_waiter_cannot_be_replayed(monkeypatch, cancelled):
    frames = []
    def emit(event, sid, payload):
        frames.append((event, payload.copy()))
        if event == "secret.request" and cancelled:
            server._clear_pending(sid)
            assert server._session_pending_prompt_snapshot(sid) is None
    monkeypatch.setattr(server, "_emit", emit)
    assert server._block("secret.request", "owner", {"env_var": "TEST_ONLY"}, timeout=0) == ""
    assert server._session_pending_prompt_snapshot("owner") is None
    assert [event for event, _ in frames].count("prompt.resolved") == 1


def test_sudo_source_callback_survives_detach_and_clears_all_peers(monkeypatch):
    from tools import terminal_tool

    class Peer:
        def __init__(self):
            self.frames = []
        def write(self, frame):
            self.frames.append(frame)
            return True

    first, second = Peer(), Peer()
    emitted = threading.Event()
    original_emit = server._emit
    def emit(event, sid, payload):
        original_emit(event, sid, payload)
        if event == "sudo.request":
            emitted.set()
    monkeypatch.setattr(server, "_emit", emit)
    session = {"transport": first, "running": True, "session_key": "durable"}
    monkeypatch.setattr(server, "_sessions", {"owner": session})
    monkeypatch.setattr(server, "_pending", {})
    monkeypatch.setattr(server, "_pending_prompt_payloads", {})
    monkeypatch.setattr(server, "_answers", {})
    result = []
    def worker():
        server._wire_callbacks("owner")
        # The tty deadline does not override the GUI callback's 120 second wait.
        result.append(terminal_tool._prompt_for_sudo_password(timeout_seconds=0))
        terminal_tool.set_sudo_password_callback(None)
    thread = threading.Thread(target=worker)
    thread.start()
    try:
        assert emitted.wait(5)
        session["transport"] = server._detached_ws_transport
        snapshot = server._session_pending_prompt_snapshot("owner")
        assert snapshot["event"] == "sudo.request"
        assert thread.is_alive()
        assert server._session_pending_prompt_snapshot("other-profile-session") is None
        server._attach_session_transport(session, first)
        server._attach_session_transport(session, second)
        request_id = snapshot["payload"]["request_id"]
        assert server._respond(1, {"request_id": request_id, "password": "test-only"}, "password")["result"]["status"] == "ok"
        thread.join(5)
        assert result == ["test-only"]
        assert server._session_pending_prompt_snapshot("owner") is None
        for peer in (first, second):
            resolved = [f["params"] for f in peer.frames if f.get("params", {}).get("type") == "prompt.resolved"]
            assert len(resolved) == 1
            assert resolved[0]["payload"] == {"event": "sudo.request", "request_id": request_id}
            assert "test-only" not in str(peer.frames)
    finally:
        server._clear_pending("owner")
        thread.join(5)

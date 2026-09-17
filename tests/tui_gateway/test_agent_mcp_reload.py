"""Agent-requested reloads are scoped and deferred until model execution ends."""
import json
import threading
from types import SimpleNamespace

import pytest

import tui_gateway.server as srv
import tools.mcp_reload_tool as tool
import tools.mcp_tool as mcp


@pytest.fixture
def bound_session(monkeypatch):
    session = {"source": "desktop", "session_key": "stored", "running": True,
               "history_lock": threading.Lock(), "agent": SimpleNamespace()}
    monkeypatch.setattr(srv, "_sessions", {"runtime": session})
    monkeypatch.setattr(tool, "_request_reload", srv._request_mcp_reload)
    token = srv._current_runtime_session_record.set(session)
    yield session
    srv._current_runtime_session_record.reset(token)


def test_requires_explicit_confirmation(bound_session):
    assert json.loads(tool.reload_mcp())["status"] == "confirm_required"
    assert "_requested_mcp_reload" not in bound_session


def test_duplicate_requests_reload_once_at_boundary(bound_session, monkeypatch):
    calls = []
    events = []
    monkeypatch.setattr(srv, "_methods", {"reload.mcp": lambda rid, p: calls.append(p) or {"result": {"status": "reloaded"}}})
    monkeypatch.setattr(srv, "_emit", lambda *args: events.append(args))
    for _ in range(2):
        assert json.loads(tool.reload_mcp(True))["status"] == "queued"
    assert not calls
    srv._apply_requested_mcp_reload("runtime", bound_session)
    srv._apply_requested_mcp_reload("runtime", bound_session)
    assert calls == [{"session_id": "runtime", "confirm": True}]
    assert "refreshed tools" in events[-1][2]["text"]


def test_stale_generation_cannot_reload_replacement(bound_session, monkeypatch):
    assert json.loads(tool.reload_mcp(True))["status"] == "queued"
    monkeypatch.setattr(srv, "_sessions", {"runtime": dict(bound_session)})
    monkeypatch.setattr(srv, "_methods", {})
    srv._apply_requested_mcp_reload("runtime", bound_session)
    assert json.loads(tool.reload_mcp(True))["status"] == "unavailable"


@pytest.mark.parametrize("source,running", [("tui", True), ("desktop", False)])
def test_rejects_unbound_surface_or_idle_turn(bound_session, source, running):
    bound_session.update(source=source, running=running)
    assert json.loads(tool.reload_mcp(True))["status"] == "unavailable"


def test_no_callback_reports_unavailable(monkeypatch):
    monkeypatch.setattr(tool, "_request_reload", None)
    assert "error" in json.loads(tool.reload_mcp(True))


def test_refresh_failure_is_not_reported_as_success(bound_session, monkeypatch):
    monkeypatch.setattr(mcp, "shutdown_mcp_servers", lambda: None)
    monkeypatch.setattr(mcp, "discover_mcp_tools", lambda: None)
    monkeypatch.setattr(srv, "_session_uses_compute_host", lambda _: False)
    monkeypatch.setattr(srv, "_compute_mcp_rev", lambda: "test")
    monkeypatch.setattr(srv, "_load_enabled_toolsets", lambda: [])
    def fail(*a, **kw):
        raise RuntimeError("snapshot refresh failed")
    monkeypatch.setattr(mcp, "refresh_agent_mcp_tools", fail)
    monkeypatch.setattr(srv, "_session_info", lambda *a: {})
    monkeypatch.setattr(srv, "_emit", lambda *a: None)
    response = srv._methods["reload.mcp"](1, {"session_id": "runtime", "confirm": True})
    assert "error" in response
    assert "snapshot refresh failed" in response["error"]["message"]


def test_reload_before_first_prompt(monkeypatch, bound_session):
    bound_session["agent"] = None
    monkeypatch.setattr(mcp, "shutdown_mcp_servers", lambda: None)
    monkeypatch.setattr(mcp, "discover_mcp_tools", lambda: [])
    monkeypatch.setattr(srv, "_session_uses_compute_host", lambda _: False)
    monkeypatch.setattr(srv, "_load_enabled_toolsets", lambda: ["desktop_ui"])
    monkeypatch.setattr(srv, "_session_info", lambda *a: {})
    monkeypatch.setattr(srv, "_emit", lambda *a: None)
    assert srv._methods["reload.mcp"](1, {"session_id": "runtime", "confirm": True})["result"]["status"] == "reloaded"

"""Archive cleanup exercises the real DB, HTTP handler and process registry."""

import shlex
import io
import json
import sys
import threading
import time
from unittest.mock import Mock

import pytest

from hermes_cli.web_models import SessionRename
from hermes_cli.web_routers import sessions
from hermes_state import SessionDB
from tools.process_registry import ProcessRegistry, ProcessSession


@pytest.mark.asyncio
async def test_archive_stops_family_processes_without_touching_unrelated_work(tmp_path, monkeypatch):
    from tools import process_registry as processes
    from tui_gateway import server

    home = tmp_path / "profile"
    home.mkdir()
    db_path = home / "state.db"
    db = SessionDB(db_path)
    db.create_session("parent", "desktop")
    db.end_session("parent", "compression")
    db.create_session("tip", "desktop", parent_session_id="parent")
    db.create_session("child", "subagent", model_config={"_delegate_from": "parent"})
    db.create_session("grandchild", "subagent", model_config={"_delegate_from": "child"})
    db.create_session("other", "desktop")
    db.append_message("tip", "user", "Keep this history")
    db.close()
    registry = ProcessRegistry()
    monkeypatch.setattr(processes, "process_registry", registry)
    monkeypatch.setattr(server, "_sessions", {})
    monkeypatch.setattr(server, "_hermes_home", str(home))
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(sessions, "_open_session_db_for_profile", lambda *a, **kw: SessionDB(db_path))
    monkeypatch.setattr(sessions, "flush_session_archive", lambda *a, **kw: True)
    command = f"{shlex.quote(sys.executable)} -c 'import time; time.sleep(120)'"
    owned = [registry.spawn_local(command, cwd=str(tmp_path), session_key=key) for key in ("parent", "child", "grandchild")]
    other = registry.spawn_local(command, cwd=str(tmp_path), session_key="other")
    finished = ProcessSession(id="already-done", command="completed build", session_key="child", exited=True, started_at=time.time())
    registry._finished[finished.id] = finished
    with monkeypatch.context() as foreign_env:
        foreign_env.setenv("HERMES_HOME", str(tmp_path / "foreign"))
        foreign = registry.spawn_local(command, cwd=str(tmp_path), session_key="parent")
    try:
        result = await sessions.rename_session_endpoint("tip", SessionRename(archived=True))
        assert result["archived"] is True
        for proc in owned:
            assert registry.get(proc.id).exited
            assert proc.process.poll() is not None
            assert proc.id in registry._completion_consumed
        assert other.process.poll() is None
        assert foreign.process.poll() is None
        assert registry.is_completion_consumed(finished.id)
        check = SessionDB(db_path)
        try:
            assert check.get_session("tip")["archived"]
            assert check.get_messages("tip")[0]["content"] == "Keep this history"
        finally:
            check.close()
        # Idempotent archive and unarchive never restart commands.
        await sessions.rename_session_endpoint("tip", SessionRename(archived=True))
        await sessions.rename_session_endpoint("tip", SessionRename(archived=False))
        assert all(proc.process.poll() is not None for proc in owned)
    finally:
        registry.kill_all()


@pytest.mark.asyncio
async def test_archive_cancels_live_family_and_pending_work_in_own_profile(tmp_path, monkeypatch):
    from tui_gateway import server
    from tools import async_delegation, process_registry as processes

    home = tmp_path / "profile"
    db = SessionDB(home / "state.db")
    db.create_session("parent", "desktop")
    db.create_session("child", "subagent", model_config={"_delegate_from": "parent"})
    db.close()

    def runtime(key, profile_home):
        return {"session_key": key, "profile_home": str(profile_home), "agent": Mock(),
                "running": True, "history_lock": threading.RLock(),
                "queued_prompt": {"text": "must not restart"}, "queued_prompts": [{"text": "nor this"}]}

    parent = runtime("parent", home)
    child = runtime("child", home)
    foreign = runtime("parent", tmp_path / "foreign")
    monkeypatch.setattr(server, "_sessions", {"runtime-parent": parent, "runtime-child": child, "foreign": foreign})
    monkeypatch.setattr(server, "_hermes_home", str(home))
    monkeypatch.setattr(processes, "process_registry", ProcessRegistry())
    interrupted = Mock(return_value=0)
    monkeypatch.setattr(async_delegation, "interrupt_for_session", interrupted)
    monkeypatch.setattr(sessions, "_open_session_db_for_profile", lambda *a, **kw: SessionDB(home / "state.db"))
    monkeypatch.setattr(sessions, "flush_session_archive", lambda *a, **kw: True)
    await sessions.rename_session_endpoint("parent", SessionRename(archived=True))
    for current in (parent, child):
        current["agent"].interrupt.assert_called_once()
        assert current["_turn_cancel_requested"]
        assert current["queued_prompt"] is None
        assert not current.get("queued_prompts")
    foreign["agent"].interrupt.assert_not_called()
    assert foreign["queued_prompt"]
    assert interrupted.call_count >= 2


def test_compute_host_archive_control_stops_its_real_process(tmp_path, monkeypatch):
    from tui_gateway import server
    from tui_gateway.compute_host import ComputeHost
    from tools import process_registry as processes

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("HERMES_COMPUTE_HOST_CHILD", "1")
    db = SessionDB(tmp_path / "state.db")
    db.create_session("parent", "desktop")
    db.close()
    agent = Mock()
    session = {"session_key": "parent", "profile_home": str(tmp_path), "agent": agent,
               "running": True, "history_lock": threading.RLock()}
    monkeypatch.setattr(server, "_sessions", {"runtime": session})
    monkeypatch.setattr(server, "_hermes_home", str(tmp_path))
    registry = ProcessRegistry()
    monkeypatch.setattr(processes, "process_registry", registry)
    proc = registry.spawn_local(f"{shlex.quote(sys.executable)} -c 'import time; time.sleep(120)'", cwd=str(tmp_path), session_key="parent")
    output = io.StringIO()
    host = ComputeHost(stdout=output, heartbeat_secs=0)
    try:
        host._handle_control({"sid": "runtime", "request_id": "archive", "route_name": "session.archive", "session_id": "parent"})
        frame = json.loads(output.getvalue().splitlines()[-1])
        assert frame["type"] == "control.ack", frame
        assert proc.id in frame["result"]["process_ids"]
        assert proc.process.poll() is not None
        agent.interrupt.assert_called_once()
    finally:
        host._executor.shutdown(wait=True)
        registry.kill_all()


@pytest.mark.asyncio
async def test_archive_failure_does_not_hide_session(tmp_path, monkeypatch):
    from fastapi import HTTPException
    from tui_gateway import server
    from tools import process_registry as processes

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    db = SessionDB(tmp_path / "state.db")
    db.create_session("parent", "desktop")
    db.close()
    registry = ProcessRegistry()
    registry._running["failed-kill"] = ProcessSession(id="failed-kill", command="remote server", session_key="parent")
    monkeypatch.setattr(registry, "kill_process", lambda *a, **kw: {"status": "error", "error": "remote unavailable"})
    monkeypatch.setattr(processes, "process_registry", registry)
    monkeypatch.setattr(server, "_sessions", {})
    monkeypatch.setattr(sessions, "_open_session_db_for_profile", lambda *a, **kw: SessionDB(tmp_path / "state.db"))
    with pytest.raises(HTTPException, match="remote unavailable") as error:
        await sessions.rename_session_endpoint("parent", SessionRename(archived=True))
    assert error.value.status_code == 409
    check = SessionDB(tmp_path / "state.db")
    try:
        assert not check.get_session("parent")["archived"]
    finally:
        check.close()


def test_delegate_archive_interrupt_is_profile_scoped(tmp_path, monkeypatch):
    from tools import async_delegation

    own, foreign = Mock(), Mock()
    home = str(tmp_path.resolve())
    monkeypatch.setattr(async_delegation, "_records", {
        "own": {"status": "running", "parent_session_id": "shared", "profile_home": home, "interrupt_fn": own},
        "foreign": {"status": "running", "parent_session_id": "shared", "profile_home": home + "-other", "interrupt_fn": foreign},
    })
    assert async_delegation.interrupt_for_session(parent_session_id="shared", profile_home=home) == 1
    own.assert_called_once()
    foreign.assert_not_called()


@pytest.mark.asyncio
async def test_archiving_idle_lazy_session_does_not_start_compute_host(tmp_path, monkeypatch):
    from tui_gateway import server

    db = SessionDB(tmp_path / "state.db")
    db.create_session("idle", "desktop")
    db.close()
    session = {"session_key": "idle", "profile_home": str(tmp_path), "agent": None,
               "running": False, "agent_ready": threading.Event(), "history_lock": threading.RLock()}
    monkeypatch.setattr(server, "_sessions", {"runtime-idle": session})
    monkeypatch.setattr(server, "_session_uses_compute_host", lambda _: True)
    supervisor = Mock(side_effect=AssertionError("Must not start a compute host to archive an idle chat"))
    monkeypatch.setattr(server, "_get_compute_host_supervisor", supervisor)
    monkeypatch.setattr(sessions, "_open_session_db_for_profile", lambda *a, **kw: SessionDB(tmp_path / "state.db"))
    monkeypatch.setattr(sessions, "flush_session_archive", lambda *a, **kw: True)
    assert (await sessions.rename_session_endpoint("idle", SessionRename(archived=True)))["archived"]
    supervisor.assert_not_called()

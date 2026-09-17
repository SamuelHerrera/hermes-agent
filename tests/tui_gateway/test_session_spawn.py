"""Independent project chats use the normal session/turn lifecycle."""
import json
import threading

import pytest

from hermes_cli import projects_db
from hermes_state import SessionDB
from tui_gateway import server

_REAL_SUBMIT = server._methods["prompt.submit"]


@pytest.fixture
def spawn_env(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    workspace = tmp_path / "repo"
    workspace.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(server, "_hermes_home", str(home))
    db = SessionDB(home / "state.db")
    monkeypatch.setattr(server, "_get_db", lambda: db)
    monkeypatch.setattr(server, "_sessions", {})
    monkeypatch.setattr(server, "_schedule_agent_build", lambda *a: None)
    monkeypatch.setattr(server, "_schedule_session_cap_enforcement", lambda: None)
    monkeypatch.setattr(server, "_enable_gateway_prompts", lambda: None)
    monkeypatch.setattr(server, "_resolve_model", lambda: "profile-default")
    events = []
    monkeypatch.setattr(server, "_broadcast_global_event", lambda name, payload=None: events.append((name, payload)))
    with projects_db.connect_closing() as conn:
        pid = projects_db.create_project(conn, name="Target", folders=[str(workspace)], primary_path=str(workspace))
    submitted = []

    def submit(rid, params):
        session = server._sessions[params["session_id"]]
        row = db.get_session(session["session_key"])
        assert row and row["cwd"] == str(workspace)
        assert not row.get("parent_session_id")
        assert session["history"] == []
        assert session["model_override"] is None
        submitted.append(params)
        session["running"] = True
        return server._ok(rid, {"status": "streaming"})

    monkeypatch.setitem(server._methods, "prompt.submit", submit)
    yield home, workspace, pid, db, submitted, events
    db.close()


def rpc(**params):
    return server.handle_request({"jsonrpc": "2.0", "id": "spawn", "method": "session.spawn", "params": params})


def test_spawn_persists_independent_project_chat_before_submit(spawn_env):
    home, workspace, pid, db, submitted, events = spawn_env
    response = rpc(project="Target", prompt="Only this handoff", title="Independent task", idempotency_key="first")
    assert "error" not in response, response
    result = response["result"]
    assert result["status"] == "started"
    assert result["project"]["id"] == pid
    assert result["link"] == f"@session:default/{result['session_id']}"
    row = db.get_session(result["session_id"])
    assert row["title"] == "Independent task"
    assert row["source"] == "desktop"
    assert submitted == [{"session_id": result["runtime_session_id"], "text": "Only this handoff"}]
    assert any(name == "sessions.changed" for name, _ in events)
    with projects_db.connect_closing() as conn:
        assert projects_db.get_active_id(conn) is None


@pytest.mark.parametrize("target", ["Target", "target", "TARGET"])
def test_resolves_name_slug_case_and_id(spawn_env, target):
    pid = spawn_env[2]
    result = rpc(project=target, prompt="handoff")["result"]
    assert rpc(project=pid, prompt="handoff")["result"]["session_id"] == result["session_id"]
    assert len(spawn_env[4]) == 1


def test_unknown_ambiguous_and_invalid_directory_create_nothing(spawn_env):
    assert "error" in rpc(project="missing", prompt="x")
    with projects_db.connect_closing() as conn:
        projects_db.create_project(conn, name="Target")
    assert "ambiguous" in rpc(project="Target", prompt="x")["error"]["message"]
    assert not server._sessions


def test_idempotency_survives_reopen_and_rejects_conflicts(spawn_env):
    first = rpc(project="Target", prompt="x", idempotency_key="same")["result"]
    again = rpc(project="Target", prompt="x", idempotency_key="same")["result"]
    assert again["session_id"] == first["session_id"]
    assert again["replayed"]
    assert "error" in rpc(project="Target", prompt="different", idempotency_key="same")
    assert len(spawn_env[4]) == 1


def test_concurrent_delivery_creates_and_submits_once(spawn_env):
    from concurrent.futures import ThreadPoolExecutor

    barrier = threading.Barrier(8)
    def request():
        barrier.wait()
        return rpc(project="Target", prompt="same", idempotency_key="race")

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: request(), range(8)))
    assert all("error" not in response for response in results)
    final = rpc(project="Target", prompt="same", idempotency_key="race")["result"]
    assert final["status"] == "started"
    assert len(server._sessions) == len(spawn_env[4]) == 1


@pytest.mark.parametrize("raises", [False, True])
def test_partial_start_failure_never_resubmits(spawn_env, monkeypatch, raises):
    calls = []
    def fail(rid, params):
        calls.append(params)
        if raises:
            raise RuntimeError("uncertain transport")
        return server._err(rid, 4090, "session limit")
    monkeypatch.setitem(server._methods, "prompt.submit", fail)
    first = rpc(project="Target", prompt="x")["result"]
    assert first["status"] == ("start_unknown" if raises else "start_failed")
    assert first["session_id"] and first["link"] and first["recovery"]
    assert spawn_env[3].get_session(first["session_id"])
    assert rpc(project="Target", prompt="x")["result"]["session_id"] == first["session_id"]
    assert len(calls) == 1


def test_profile_namespace_isolation_and_unknown_profile_fail_closed(spawn_env, tmp_path, monkeypatch):
    other = tmp_path / "other-profile"
    other.mkdir()
    monkeypatch.setattr(server, "_profile_home", lambda name: other if name == "other" else None)
    assert "error" in rpc(project="Target", prompt="x", profile="other")
    assert "error" in rpc(project="Target", prompt="x", profile="does-not-exist")
    assert not server._sessions


def test_tool_is_bridged_without_moving_caller(spawn_env, monkeypatch):
    from tools import project_tools
    from tools.registry import registry
    from toolsets import TOOLSETS
    assert hasattr(project_tools, "session_spawn")
    assert "session_spawn" in TOOLSETS["project"]["tools"]
    assert registry.get_entry("session_spawn") is not None
    received = []
    monkeypatch.setattr(project_tools, "_spawn_callback", lambda task, args: received.append((task, args)) or {"status": "started"})
    result = json.loads(project_tools.session_spawn("Target", "supplied prompt", task_id="caller"))
    assert result["status"] == "started"
    assert received[0][0] == "caller"
    assert received[0][1]["prompt"] == "supplied prompt"
    assert not server._sessions


def test_real_turn_lifecycle_outlives_caller_close(spawn_env, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    monkeypatch.setitem(server._methods, "prompt.submit", _REAL_SUBMIT)
    monkeypatch.setattr(server, "_start_agent_build", lambda *a: None)
    monkeypatch.setattr(server, "_wait_agent_for_prompt", lambda *a: None)
    monkeypatch.setattr(server, "_session_uses_compute_host", lambda *a: False)
    monkeypatch.setattr(server, "_emit", lambda *a: None)
    def run(rid, sid, session, text, **kwargs):
        entered.set()
        release.wait(10)
        session["running"] = False
    monkeypatch.setattr(server, "_run_prompt_submit", run)
    caller = server._methods["session.create"]("caller", {"source": "desktop"})["result"]
    result = rpc(project="Target", prompt="independent")["result"]
    try:
        assert entered.wait(5)
        server._methods["session.close"]("close", {"session_id": caller["session_id"]})
        spawned = server._sessions[result["runtime_session_id"]]
        assert spawned["running"] and spawned["_run_thread"].is_alive()
        assert not spawned.get("_turn_cancel_requested")
        assert not spawned["close_on_disconnect"]
    finally:
        release.set()
        server._sessions[result["runtime_session_id"]]["_run_thread"].join(5)


def test_target_profile_owns_session_and_git_metadata(spawn_env, tmp_path, monkeypatch):
    import subprocess
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    other = tmp_path / "other"
    other.mkdir()
    cwd = tmp_path / "other-repo"
    cwd.mkdir()
    subprocess.run(["git", "init", "-b", "target-branch", str(cwd)], check=True, capture_output=True)
    monkeypatch.setattr(server, "_profile_home", lambda name: other if name == "other" else None)
    token = set_hermes_home_override(other)
    try:
        with projects_db.connect_closing() as conn:
            pid = projects_db.create_project(conn, name="Target", folders=[str(cwd)], primary_path=str(cwd))
    finally:
        reset_hermes_home_override(token)
    def submit(rid, params):
        session = server._sessions[params["session_id"]]
        assert session["profile_home"] == str(other)
        assert session["model_override"] is None
        with server._session_db(session) as db:
            row = db.get_session(session["session_key"])
            assert row["git_branch"] == "target-branch"
            assert row["cwd"] == str(cwd)
            assert row["profile_name"] == "other"
        return server._ok(rid, {"status": "streaming"})
    monkeypatch.setitem(server._methods, "prompt.submit", submit)
    result = rpc(project="Target", prompt="x", profile="other")["result"]
    assert result["status"] == "started", result
    assert result["project"]["id"] == pid
    assert result["link"].startswith("@session:other/")
    assert spawn_env[3].get_session(result["session_id"]) is None


def test_empty_spawn_is_visible_before_submit_even_when_start_fails(spawn_env, monkeypatch):
    home, cwd, pid, db, calls, events = spawn_env
    def inspect(rid, params):
        tree, _ = server._build_project_tree(db, preview_limit=20, hydrate=True, session_limit=2000, include_discovered=False)
        target = next(project for project in tree["projects"] if project["id"] == pid)
        assert target["previewSessions"][0]["id"] == server._sessions[params["session_id"]]["session_key"]
        return server._err(rid, 5000, "test unavailable provider")
    monkeypatch.setitem(server._methods, "prompt.submit", inspect)
    result = rpc(project=pid, prompt="x")["result"]
    assert result["status"] == "start_failed", result


def test_explicit_empty_rows_preserve_sql_pagination_and_hide_other_drafts(spawn_env):
    db = spawn_env[3]
    ids = [rpc(project="Target", prompt=f"task {n}")["result"]["session_id"] for n in range(3)]
    db.create_session("unrelated-draft", source="desktop")
    seen = []
    for offset in range(4):
        rows = db.list_sessions_rich(min_message_count=1, include_empty_ids=ids,
                                    limit=1, offset=offset, order_by_last_active=True)
        seen.extend(row["id"] for row in rows)
    assert len(seen) == len(ids)
    assert set(seen) == set(ids)


def test_renderer_request_carries_authoritative_shared_profile_not_tool_args(spawn_env, monkeypatch):
    caller = server._methods["session.create"]("caller", {"source": "desktop"})["result"]
    session = server._sessions[caller["session_id"]]
    session.update(profile_name="work", profile_home="/test-only/work")
    received = []
    monkeypatch.setattr(server, "_block", lambda event, sid, payload, **kw: received.append(payload) or '{"status":"started"}')
    server._request_session_spawn(session["session_key"], {"project": "Target", "prompt": "x", "caller_profile_scope": "injected"})
    assert received[0]["caller_profile_scope"] == "work"
    session.update(profile_name="default", profile_home=None)
    server._request_session_spawn(session["session_key"], {"project": "Target", "prompt": "x"})
    assert received[1]["caller_profile_scope"] is None

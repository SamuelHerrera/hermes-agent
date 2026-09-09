"""Conservative recovery reads durable rows, never a repaired conversation."""

import time
import pytest

from hermes_state import SessionDB
from tui_gateway import server, turn_marker


@pytest.mark.parametrize("reason", ["completed", "cancelled", "error"])
def test_explicit_terminal_outcome_does_not_resurrect_tool_tail(tmp_path, reason):
    stamp = time.time()
    turn_marker.record_turn_start(tmp_path, "session", "task")
    turn_marker.clear_turn_marker(tmp_path, "session", reason=reason)
    assert turn_marker.read_turn_marker(tmp_path, "session") is None
    assert (
        turn_marker.inspect_interrupted_tail(
            tmp_path,
            "session",
            [{"role": "assistant", "tool_calls": [{"id": "call"}], "timestamp": stamp}],
        )
        is None
    )


@pytest.mark.parametrize("stamp", [float("nan"), float("inf"), -1])
def test_invalid_freshness_evidence_does_not_authorize_auto_continue(tmp_path, stamp):
    import json

    path = tmp_path / "desktop" / "interrupted_turns.json"
    path.parent.mkdir()
    path.write_text(
        json.dumps({"session": {"prompt": "task", "started_at": stamp, "attempts": 0}})
    )
    assert turn_marker.read_turn_marker(tmp_path, "session") is None


def test_policy_write_cannot_suppress_a_newer_user_turn(tmp_path):
    turn_marker.record_turn_start(tmp_path, "session", "old")
    old = turn_marker.read_turn_marker(tmp_path, "session")
    turn_marker.record_turn_start(tmp_path, "session", "new")
    turn_marker.suppress_turn_marker(tmp_path, "session", "stale", expected=old)
    assert not turn_marker.read_turn_marker(tmp_path, "session").get("suppression")


def test_terminal_receipts_remain_bounded(tmp_path):
    import json

    for i in range(40):
        turn_marker.clear_turn_marker(tmp_path, str(i), reason="cancelled")
    entries = json.loads((tmp_path / "desktop" / "interrupted_turns.json").read_text())
    assert len(entries) <= turn_marker._MAX_ENTRIES


def test_late_tool_result_after_stop_does_not_resurrect_turn(tmp_path):
    turn_marker.clear_turn_marker(tmp_path, "session", reason="cancelled")
    assert (
        turn_marker.inspect_interrupted_tail(
            tmp_path,
            "session",
            [{"role": "tool", "content": "late result", "timestamp": time.time() + 1}],
        )
        is None
    )


def test_clean_final_reply_is_not_interrupted(tmp_path):
    assert (
        turn_marker.inspect_interrupted_tail(
            tmp_path,
            "session",
            [{"role": "assistant", "content": "done", "timestamp": time.time()}],
        )
        is None
    )


@pytest.fixture
def resume_db(tmp_path, monkeypatch):
    db = SessionDB(db_path=tmp_path / "state.db")
    db.create_session("recovery-test", source="desktop")
    monkeypatch.setattr(server, "_hermes_home", tmp_path)
    monkeypatch.setattr(server, "_get_db", lambda: db)
    monkeypatch.setattr(server, "_profile_home", lambda profile: None)
    monkeypatch.setattr(server, "_enable_gateway_prompts", lambda: None)
    monkeypatch.setattr(server, "_schedule_agent_build", lambda *a: None)
    monkeypatch.setattr(server, "_schedule_session_cap_enforcement", lambda: None)
    monkeypatch.setattr(server, "_default_session_cwd", lambda: str(tmp_path))
    monkeypatch.setattr(server, "_sessions", {})
    yield db
    db.close()


@pytest.mark.parametrize("omit", [False, True])
@pytest.mark.parametrize("eager", [False, True])
def test_resume_reads_raw_tail_before_repair_and_warm_resume_retains_signal(
    resume_db, omit, eager, monkeypatch
):
    if eager:
        import types

        monkeypatch.setattr(
            server,
            "_make_agent",
            lambda *a, **kw: types.SimpleNamespace(session_id="recovery-test"),
        )
        monkeypatch.setattr(server, "_wire_callbacks", lambda *a, **kw: None)
    resume_db.append_message("recovery-test", "user", "task")
    resume_db.append_message(
        "recovery-test",
        "assistant",
        "",
        tool_calls=[
            {
                "id": "call",
                "type": "function",
                "function": {"name": "terminal", "arguments": "{}"},
            }
        ],
    )
    request = {
        "id": "1",
        "method": "session.resume",
        "params": {
            "session_id": "recovery-test",
            "omit_messages": omit,
            "eager_build": eager,
        },
    }
    for _ in range(2):
        result = server.handle_request(request)["result"]
        assert result.get("recovery", {}).get("needs_manual_continue") is True
        assert result["status"] == "error"
        assert not result["running"]
        assert "auto_continue" not in result
        history = server._sessions[result["session_id"]]["history"]
        assert any(row.get("effect_disposition") == "unknown" for row in history)


def test_open_session_with_clean_reply_is_not_an_incomplete_turn(resume_db):
    resume_db.append_message("recovery-test", "user", "task")
    resume_db.append_message("recovery-test", "assistant", "finished")
    assert resume_db.get_session("recovery-test")["ended_at"] is None
    result = server.handle_request({
        "id": "1",
        "method": "session.resume",
        "params": {"session_id": "recovery-test"},
    })["result"]
    assert not result.get("recovery")
    assert "auto_continue" not in result
    assert not result["running"]


def test_synthetic_tool_result_does_not_refresh_freshness(resume_db, tmp_path):
    resume_db.append_message(
        "recovery-test", "assistant", "", tool_calls=[{"id": "call"}]
    )
    before = resume_db.get_messages("recovery-test")[-1]["timestamp"]
    time.sleep(0.01)
    resume_db.append_message(
        "recovery-test",
        "tool",
        "[Orphan recovery: its effect is UNKNOWN. Inspect state before retrying.]",
        tool_call_id="call",
    )
    evidence = server._read_recovery_evidence(resume_db, tmp_path, "recovery-test")
    assert evidence["updated_at"] == before


def test_missing_marker_stale_tail_is_visible_but_never_scheduled(
    resume_db, monkeypatch
):
    resume_db.append_message(
        "recovery-test", "assistant", "", tool_calls=[{"id": "call"}]
    )
    import types

    monkeypatch.setattr(
        server, "time", types.SimpleNamespace(time=lambda: time.time() + 3600)
    )
    result = server.handle_request({
        "id": "1",
        "method": "session.resume",
        "params": {"session_id": "recovery-test"},
    })["result"]
    assert result["recovery"]["reason"] == "stale"
    assert result["recovery"]["needs_manual_continue"]
    assert "auto_continue" not in result


def test_live_lease_deferral_is_revisited_on_warm_resume(
    resume_db, tmp_path, monkeypatch
):
    turn_marker.record_turn_start(tmp_path, "recovery-test", "task")
    live = [True]
    monkeypatch.setattr(server, "_session_has_live_detached_turn", lambda *a: live[0])
    monkeypatch.setattr(server, "_has_live_durable_turn_lease", lambda *a: live[0])
    monkeypatch.setattr(
        server, "_load_cfg", lambda: {"desktop": {"auto_continue": {"enabled": False}}}
    )
    request = {
        "id": "1",
        "method": "session.resume",
        "params": {"session_id": "recovery-test"},
    }
    first = server.handle_request(request)["result"]
    assert first["running"]
    live[0] = False
    second = server.handle_request(request)["result"]
    assert second.get("recovery", {}).get("reason") == "disabled"


def test_stop_request_retires_marker_before_backend_death(tmp_path, monkeypatch):
    import contextlib
    import threading
    import types

    session = {
        "session_key": "stopped",
        "profile_home": str(tmp_path),
        "history_lock": threading.Lock(),
        "running": False,
        "agent": types.SimpleNamespace(),
    }
    turn_marker.record_turn_start(tmp_path, "stopped", "task")
    monkeypatch.setattr(server, "_sess_nowait", lambda *a: (session, None))
    monkeypatch.setattr(server, "_sess", lambda *a: (session, None))
    monkeypatch.setattr(server, "_session_uses_compute_host", lambda *a: False)
    monkeypatch.setattr(
        server, "_session_control_effect_claim", lambda *a: contextlib.nullcontext()
    )
    monkeypatch.setattr(server, "_tts_stream_stop", lambda: None)
    monkeypatch.setattr(server, "_clear_pending_for_session_record", lambda *a: None)
    result = server.handle_request({
        "id": "stop",
        "method": "session.interrupt",
        "params": {"session_id": "stopped"},
    })
    assert "result" in result
    assert turn_marker.read_turn_marker(tmp_path, "stopped") is None


def test_missing_marker_dangling_call_requires_manual_continue(tmp_path):
    rows = [
        {"id": 1, "role": "user", "content": "task", "timestamp": time.time()},
        {
            "id": 2,
            "role": "assistant",
            "tool_calls": [{"id": "call"}],
            "timestamp": time.time(),
        },
    ]
    inspect = getattr(turn_marker, "inspect_interrupted_tail", lambda *a: None)
    recovery = inspect(tmp_path, "session", rows)
    assert recovery is not None, (
        "raw dangling tool calls must not silently hydrate idle"
    )
    assert recovery["needs_manual_continue"] is True
    assert recovery["reason"] == "missing_marker"
    assert recovery["source"] == "raw_transcript"
    assert "task" not in str(recovery)

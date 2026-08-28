"""Focused behavioral coverage for shared live-session transports."""

import threading
import types

import pytest

from tui_gateway import server


class _CollectingTransport:
    def __init__(
        self,
        name: str = "",
        *,
        write_ok: bool = True,
        written: threading.Event | None = None,
    ):
        self.name = name
        self.write_ok = write_ok
        self.written = written
        self.frames: list[dict] = []
        self.closed = False

    def write(self, obj: dict) -> bool:
        self.frames.append(obj)
        if self.written is not None:
            self.written.set()
        return self.write_ok

    def close(self) -> None:
        self.closed = True


class _ExplodingTransport:
    def write(self, obj: dict) -> bool:
        raise RuntimeError("serialization bug")

    def close(self) -> None:
        return None


def _session(agent=None, **extra):
    return {
        "agent": agent if agent is not None else types.SimpleNamespace(),
        "session_key": "session-key",
        "history": [],
        "history_lock": threading.Lock(),
        "history_version": 0,
        "running": False,
        "attached_images": [],
        "image_counter": 0,
        "cols": 80,
        "slash_worker": None,
        "show_reasoning": False,
        "tool_progress_mode": "all",
        **extra,
    }


def test_live_session_payload_replays_pending_approval_to_late_joiner():
    from tools import approval

    entry = approval._ApprovalEntry(
        {
            "allow_permanent": False,
            "command": "rm -rf /tmp/phase1",
            "description": "recursive delete",
        }
    )
    approval._gateway_queues["session-key"] = [entry]
    try:
        session = _session(running=True)

        snapshot = server._session_pending_prompt_snapshot("late-join", session)

        assert snapshot == {
            "event": "approval.request",
            "payload": {
                "allow_permanent": False,
                "choices": ["once", "session", "deny"],
                "command": "rm -rf /tmp/phase1",
                "description": "recursive delete",
                "request_id": entry.data["request_id"],
            },
        }
        assert server._session_live_status("late-join", session) == "waiting"
    finally:
        approval._gateway_queues.pop("session-key", None)


def test_session_fanout_transport_writes_to_all_live_peers():
    first = _CollectingTransport("first")
    second = _CollectingTransport("second")
    fanout = server.SessionFanoutTransport(first)
    fanout.add(second)

    frame = {"jsonrpc": "2.0", "method": "event"}

    assert fanout.write(frame) is True
    assert first.frames == [frame]
    assert second.frames == [frame]
    assert fanout.count() == 2


def test_attach_session_transport_converts_single_transport_to_fanout():
    first = _CollectingTransport("first")
    second = _CollectingTransport("second")
    session = {"transport": first}

    server._attach_session_transport(session, second)

    assert server._session_transport_contains(session, first)
    assert server._session_transport_contains(session, second)
    assert server._session_transport_count(session) == 2


def test_session_fanout_transport_prunes_failed_peer_without_closing_peers():
    good = _CollectingTransport("good")
    bad = _CollectingTransport("bad", write_ok=False)
    fanout = server.SessionFanoutTransport(good, bad)

    assert fanout.write({"jsonrpc": "2.0", "method": "event"}) is True
    assert fanout.contains(good)
    assert not fanout.contains(bad)

    fanout.close()
    assert fanout.count() == 0
    assert good.closed is False
    assert bad.closed is False


def test_session_fanout_transport_surfaces_programming_errors_without_pruning_peer():
    exploding = _ExplodingTransport()
    good = _CollectingTransport("good")
    fanout = server.SessionFanoutTransport(exploding, good)
    frame = {"jsonrpc": "2.0", "method": "event"}

    with pytest.raises(RuntimeError, match="serialization bug"):
        fanout.write(frame)

    assert good.frames == [frame]
    assert fanout.contains(exploding)
    assert fanout.contains(good)


def test_close_transport_removes_one_fanout_peer_without_detaching(monkeypatch):
    reap_calls = []
    monkeypatch.setattr(server, "_schedule_ws_orphan_reap", reap_calls.append)
    first = _CollectingTransport("first")
    second = _CollectingTransport("second")
    session = _session(close_on_disconnect=False)
    server._attach_session_transport(session, first)
    server._attach_session_transport(session, second)
    server._sessions["fanout-sid"] = session
    try:
        assert server._close_sessions_for_transport(first) == (0, 0)
        assert not server._session_transport_contains(session, first)
        assert server._session_transport_contains(session, second)

        server._emit("message.delta", "fanout-sid", {"text": "still live"})

        assert len(second.frames) == 1
        assert reap_calls == []
    finally:
        server._sessions.pop("fanout-sid", None)


def test_event_write_detaches_and_schedules_reap_when_all_fanout_peers_fail(
    monkeypatch,
):
    reap_calls = []
    monkeypatch.setattr(server, "_schedule_ws_orphan_reap", reap_calls.append)
    first = _CollectingTransport("first", write_ok=False)
    second = _CollectingTransport("second", write_ok=False)
    session = _session(transport=first)
    server._attach_session_transport(session, second)
    server._sessions["sid-all-failed"] = session
    try:
        accepted = server.write_json(
            {
                "jsonrpc": "2.0",
                "method": "event",
                "params": {"type": "message.delta", "session_id": "sid-all-failed"},
            }
        )

        assert accepted is False
        assert session["transport"] is server._detached_ws_transport
        assert session.get("viewers") == {}
        assert reap_calls == ["sid-all-failed"]
    finally:
        server._sessions.pop("sid-all-failed", None)


def test_event_write_closes_close_on_disconnect_session_when_all_peers_fail(
    monkeypatch,
):
    torn_down = []
    monkeypatch.setattr(
        server,
        "_teardown_popped_session",
        lambda session, *, end_reason: torn_down.append((session, end_reason)) or True,
    )
    first = _CollectingTransport("first", write_ok=False)
    second = _CollectingTransport("second", write_ok=False)
    session = _session(transport=first, close_on_disconnect=True)
    server._attach_session_transport(session, second)
    server._sessions["sid-close-on-failure"] = session
    try:
        accepted = server.write_json(
            {
                "jsonrpc": "2.0",
                "method": "event",
                "params": {
                    "type": "message.delta",
                    "session_id": "sid-close-on-failure",
                },
            }
        )

        assert accepted is False
        assert "sid-close-on-failure" not in server._sessions
        assert torn_down == [(session, "transport_write_failed")]
    finally:
        server._sessions.pop("sid-close-on-failure", None)


def test_running_detached_session_reschedules_orphan_reap_until_turn_settles(
    monkeypatch,
):
    callbacks = []
    torn_down = []

    class _Timer:
        daemon = False

        def __init__(self, _interval, callback):
            callbacks.append(callback)

        def start(self):
            return None

    monkeypatch.setattr(server.threading, "Timer", _Timer)
    monkeypatch.setattr(server, "_WS_ORPHAN_REAP_GRACE_S", 1)
    monkeypatch.setattr(server, "_session_has_active_delegations", lambda *_args: False)
    monkeypatch.setattr(
        server,
        "_teardown_popped_session",
        lambda session, *, end_reason: torn_down.append((session, end_reason)) or True,
    )
    session = _session(transport=server._detached_ws_transport, running=True)
    server._sessions["sid-running-orphan"] = session
    try:
        server._schedule_ws_orphan_reap("sid-running-orphan")
        assert len(callbacks) == 1

        callbacks.pop(0)()
        assert len(callbacks) == 1
        assert server._sessions["sid-running-orphan"] is session

        session["running"] = False
        callbacks.pop(0)()
        assert "sid-running-orphan" not in server._sessions
        assert torn_down == [(session, "ws_orphan_reap")]
    finally:
        server._sessions.pop("sid-running-orphan", None)


def test_prompt_response_is_first_wins_while_request_is_still_pending():
    event = threading.Event()
    server._pending["rid-first"] = ("sid", event)
    try:
        first = server.handle_request(
            {
                "id": "first",
                "method": "clarify.respond",
                "params": {"request_id": "rid-first", "answer": "alpha"},
            }
        )
        second = server.handle_request(
            {
                "id": "second",
                "method": "clarify.respond",
                "params": {"request_id": "rid-first", "answer": "beta"},
            }
        )

        assert first["result"]["status"] == "ok"
        assert second["result"]["status"] == "already_resolved"
        assert server._answers["rid-first"] == "alpha"
    finally:
        server._pending.pop("rid-first", None)
        server._answers.pop("rid-first", None)


def test_interrupt_clear_preserves_already_accepted_prompt_answer():
    transport = _CollectingTransport("attached")
    event = threading.Event()
    session = _session(transport=transport)
    server._sessions["sid-accepted"] = session
    server._pending["rid-accepted"] = ("sid-accepted", event)
    token = server.bind_transport(transport)
    try:
        response = server.handle_request(
            {
                "id": "accept-first",
                "method": "clarify.respond",
                "params": {"request_id": "rid-accepted", "answer": "alpha"},
            }
        )
        assert response is not None
        assert response["result"]["status"] == "ok"
        assert server._answers["rid-accepted"] == "alpha"

        assert server._clear_pending_for_session_record("sid-accepted", session) is True
        assert server._answers["rid-accepted"] == "alpha"
    finally:
        server.reset_transport(token)
        server._sessions.pop("sid-accepted", None)
        server._pending.pop("rid-accepted", None)
        server._answers.pop("rid-accepted", None)


def test_unattached_transport_cannot_answer_live_prompt():
    attached = _CollectingTransport("attached")
    unrelated = _CollectingTransport("unrelated")
    event = threading.Event()
    server._sessions["sid-prompt"] = _session(transport=attached)
    server._pending["rid-prompt"] = ("sid-prompt", event)
    token = server.bind_transport(unrelated)
    try:
        response = server.handle_request(
            {
                "id": "answer-unattached",
                "method": "clarify.respond",
                "params": {"request_id": "rid-prompt", "answer": "hijack"},
            }
        )

        assert response["error"]["code"] == 4030
        assert not event.is_set()
        assert "rid-prompt" not in server._answers
    finally:
        server.reset_transport(token)
        server._sessions.pop("sid-prompt", None)
        server._pending.pop("rid-prompt", None)
        server._answers.pop("rid-prompt", None)


def test_attached_secondary_has_control_authority_but_unattached_peer_does_not():
    first = _CollectingTransport("first")
    second = _CollectingTransport("second")
    unrelated = _CollectingTransport("unrelated")
    session = _session(transport=first)
    server._attach_session_transport(session, second)

    second_token = server.bind_transport(second)
    try:
        assert server._session_control_authority_error("second", session) is None
    finally:
        server.reset_transport(second_token)

    unrelated_token = server.bind_transport(unrelated)
    try:
        rejected = server._session_control_authority_error("unrelated", session)
    finally:
        server.reset_transport(unrelated_token)

    assert rejected["error"]["code"] == 4030


def test_session_capabilities_advertise_multi_client_fanout():
    assert server._session_capabilities()["session_multi_client_fanout"] is True


def test_session_activate_attaches_second_transport_without_stealing_first(
    monkeypatch,
):
    monkeypatch.setattr(server, "_session_info", lambda agent: {"model": agent.model})
    first = _CollectingTransport("first")
    second = _CollectingTransport("second")
    server._sessions["sid-shared"] = _session(
        agent=types.SimpleNamespace(model="model-shared"),
        session_key="key-shared",
        transport=first,
    )
    token = server.bind_transport(second)
    try:
        response = server.handle_request(
            {
                "id": "activate-second",
                "method": "session.activate",
                "params": {"session_id": "sid-shared"},
            }
        )
        assert response["result"]["session_id"] == "sid-shared"

        server._emit("message.delta", "sid-shared", {"text": "shared"})

        assert [frame["params"]["type"] for frame in first.frames] == [
            "message.delta"
        ]
        assert [frame["params"]["type"] for frame in second.frames] == [
            "message.delta"
        ]
    finally:
        server.reset_transport(token)
        server._sessions.pop("sid-shared", None)


def test_session_activate_fails_closed_when_teardown_claims_generation(
    monkeypatch,
):
    entered_payload = threading.Event()
    release_payload = threading.Event()
    first = _CollectingTransport("first")
    second = _CollectingTransport("second")
    session = _session(
        agent=types.SimpleNamespace(model="model-shared"),
        session_key="key-activate-race",
        transport=first,
    )
    original_payload = server._live_session_payload

    def blocked_payload(*args, **kwargs):
        entered_payload.set()
        assert release_payload.wait(timeout=2)
        return original_payload(*args, **kwargs)

    monkeypatch.setattr(server, "_live_session_payload", blocked_payload)
    server._sessions["sid-activate-race"] = session
    outcome = {}
    activation_done = threading.Event()

    def activate():
        token = server.bind_transport(second)
        try:
            outcome["response"] = server.handle_request(
                {
                    "id": "activate-race",
                    "method": "session.activate",
                    "params": {"session_id": "sid-activate-race"},
                }
            )
        finally:
            server.reset_transport(token)
            activation_done.set()

    worker = threading.Thread(target=activate)
    worker.start()
    try:
        assert entered_payload.wait(timeout=2)
        popped = server._pop_session_by_id("sid-activate-race")
        assert popped is session
        release_payload.set()
        assert activation_done.wait(timeout=5)
        worker.join(timeout=1)

        assert not worker.is_alive()
        assert outcome["response"]["error"]["code"] == 4001
        assert not server._session_transport_contains(session, second)
    finally:
        release_payload.set()
        worker.join(timeout=5)
        server._sessions.pop("sid-activate-race", None)


def test_session_steer_allows_attached_secondary_and_rejects_unattached_peer():
    first = _CollectingTransport("first")
    second = _CollectingTransport("second")
    unrelated = _CollectingTransport("unrelated")
    agent = types.SimpleNamespace(steer=lambda _text: True)
    session = _session(agent=agent, transport=first)
    server._attach_session_transport(session, second)
    server._sessions["sid-control"] = session
    try:
        token = server.bind_transport(second)
        try:
            accepted = server.handle_request(
                {
                    "id": "steer-attached",
                    "method": "session.steer",
                    "params": {"session_id": "sid-control", "text": "continue"},
                }
            )
        finally:
            server.reset_transport(token)
        assert accepted["result"]["status"] == "queued"

        token = server.bind_transport(unrelated)
        try:
            rejected = server.handle_request(
                {
                    "id": "steer-unattached",
                    "method": "session.steer",
                    "params": {"session_id": "sid-control", "text": "hijack"},
                }
            )
        finally:
            server.reset_transport(token)
        assert rejected["error"]["code"] == 4030
    finally:
        server._sessions.pop("sid-control", None)


def test_unattached_transport_cannot_close_live_session():
    attached = _CollectingTransport("attached")
    unrelated = _CollectingTransport("unrelated")
    session = _session(transport=attached)
    server._sessions["sid-close"] = session
    token = server.bind_transport(unrelated)
    try:
        response = server.handle_request(
            {
                "id": "close-unattached",
                "method": "session.close",
                "params": {"session_id": "sid-close"},
            }
        )
    finally:
        server.reset_transport(token)

    try:
        assert response is not None
        assert response["error"]["code"] == 4030
        assert server._sessions["sid-close"] is session
    finally:
        server._sessions.pop("sid-close", None)


def test_steer_revalidates_live_generation_before_side_effect(monkeypatch):
    attached = _CollectingTransport("attached")
    effects = []
    session = _session(
        agent=types.SimpleNamespace(steer=lambda text: effects.append(text) or True),
        transport=attached,
    )
    server._sessions["sid-steer-race"] = session

    def pop_before_claim(_rid, _session):
        server._sessions.pop("sid-steer-race", None)
        return None

    monkeypatch.setattr(server, "_session_control_authority_error", pop_before_claim)
    token = server.bind_transport(attached)
    try:
        response = server.handle_request(
            {
                "id": "steer-race",
                "method": "session.steer",
                "params": {"session_id": "sid-steer-race", "text": "too late"},
            }
        )
    finally:
        server.reset_transport(token)
        server._sessions.pop("sid-steer-race", None)

    assert response is not None
    assert response["error"]["code"] == 4090
    assert effects == []


def test_unattached_interrupt_is_rejected_before_global_tts_side_effect(monkeypatch):
    attached = _CollectingTransport("attached")
    unrelated = _CollectingTransport("unrelated")
    session = _session(transport=attached)
    server._sessions["sid-interrupt"] = session
    tts_stops = []
    monkeypatch.setattr(server, "_tts_stream_stop", lambda: tts_stops.append(True))
    token = server.bind_transport(unrelated)
    try:
        rejected = server.handle_request(
            {
                "id": "interrupt-unattached",
                "method": "session.interrupt",
                "params": {"session_id": "sid-interrupt"},
            }
        )
    finally:
        server.reset_transport(token)
        server._sessions.pop("sid-interrupt", None)

    assert rejected["error"]["code"] == 4030
    assert tts_stops == []


def test_approval_entries_are_resolved_by_request_id():
    from tools import approval

    first = approval._ApprovalEntry({"command": "first"})
    second = approval._ApprovalEntry({"command": "second"})
    first_request_id = first.data["request_id"]
    second_request_id = second.data["request_id"]
    with approval._lock:
        approval._gateway_queues["approval-session"] = [first, second]
    try:
        resolved = approval.resolve_gateway_approval(
            "approval-session",
            "deny",
            request_id=second_request_id,
        )

        assert resolved == 1
        assert second.result == "deny"
        assert first.result is None
        assert first.data["request_id"] == first_request_id
    finally:
        with approval._lock:
            approval._gateway_queues.pop("approval-session", None)


def test_approval_response_is_first_wins_across_attached_peers():
    from tools import approval

    first = _CollectingTransport("first")
    second = _CollectingTransport("second")
    unrelated = _CollectingTransport("unrelated")
    session = _session(session_key="approval-session", transport=first)
    server._attach_session_transport(session, second)
    server._sessions["sid-approval"] = session
    entry = approval._ApprovalEntry({"request_id": "approval-request"})
    with approval._lock:
        approval._gateway_queues["approval-session"] = [entry]
    try:
        token = server.bind_transport(unrelated)
        try:
            rejected = server.handle_request(
                {
                    "id": "approval-unattached",
                    "method": "approval.respond",
                    "params": {
                        "session_id": "sid-approval",
                        "request_id": "approval-request",
                        "choice": "deny",
                    },
                }
            )
        finally:
            server.reset_transport(token)
        assert rejected["error"]["code"] == 4030

        token = server.bind_transport(first)
        try:
            accepted = server.handle_request(
                {
                    "id": "approval-first",
                    "method": "approval.respond",
                    "params": {
                        "session_id": "sid-approval",
                        "request_id": "approval-request",
                        "choice": "once",
                    },
                }
            )
        finally:
            server.reset_transport(token)

        token = server.bind_transport(second)
        try:
            duplicate = server.handle_request(
                {
                    "id": "approval-second",
                    "method": "approval.respond",
                    "params": {
                        "session_id": "sid-approval",
                        "request_id": "approval-request",
                        "choice": "deny",
                    },
                }
            )
        finally:
            server.reset_transport(token)

        assert accepted["result"]["resolved"] == 1
        assert duplicate["result"]["resolved"] == 0
        assert entry.result == "once"
    finally:
        with approval._lock:
            approval._gateway_queues.pop("approval-session", None)
        server._sessions.pop("sid-approval", None)


def test_pending_prompt_is_fanned_out_and_either_attached_peer_can_answer():
    first_written = threading.Event()
    second_written = threading.Event()
    first = _CollectingTransport("first", written=first_written)
    second = _CollectingTransport("second", written=second_written)
    session = _session(transport=first)
    server._attach_session_transport(session, second)
    server._sessions["sid-prompt-fanout"] = session
    result = {}
    worker = threading.Thread(
        target=lambda: result.setdefault(
            "answer",
            server._block(
                "clarify.request",
                "sid-prompt-fanout",
                {"question": "Choose"},
                timeout=2.0,
            ),
        )
    )
    worker.start()
    try:
        assert first_written.wait(timeout=2.0)
        assert second_written.wait(timeout=2.0)
        request_id = second.frames[0]["params"]["payload"]["request_id"]

        token = server.bind_transport(second)
        try:
            response = server.handle_request(
                {
                    "id": "answer-second",
                    "method": "clarify.respond",
                    "params": {"request_id": request_id, "answer": "second peer"},
                }
            )
        finally:
            server.reset_transport(token)

        worker.join(timeout=1.0)
        assert response["result"]["status"] == "ok"
        assert result["answer"] == "second peer"
    finally:
        server._sessions.pop("sid-prompt-fanout", None)
        worker.join(timeout=2.5)


def test_prompt_response_fails_closed_while_session_is_closing():
    event = threading.Event()
    transport = _CollectingTransport("closing")
    session = _session(transport=transport, _closing=True)
    server._sessions["closing-session"] = session
    server._pending["rid-closing-session"] = ("closing-session", event)
    token = server.bind_transport(transport)
    try:
        response = server.handle_request(
            {
                "id": "closing-answer",
                "method": "clarify.respond",
                "params": {
                    "request_id": "rid-closing-session",
                    "answer": "must not win",
                },
            }
        )

        assert response["error"]["code"] == 4090
        assert not event.is_set()
        assert "rid-closing-session" not in server._answers
    finally:
        server.reset_transport(token)
        server._sessions.pop("closing-session", None)
        server._pending.pop("rid-closing-session", None)
        server._answers.pop("rid-closing-session", None)


def test_teardown_claim_revokes_authority_on_the_popped_session_record():
    transport = _CollectingTransport("closing")
    session = _session(transport=transport)
    server._sessions["closing-claim"] = session

    popped = server._pop_session_by_id("closing-claim")
    token = server.bind_transport(transport)
    try:
        rejected = server._session_control_authority_error("late", popped)
    finally:
        server.reset_transport(token)

    assert rejected["error"]["code"] == 4090


def test_close_on_disconnect_waits_for_last_attached_peer(monkeypatch):
    first = _CollectingTransport("first")
    second = _CollectingTransport("second")
    session = _session(close_on_disconnect=True)
    server._attach_session_transport(session, first)
    server._attach_session_transport(session, second)
    server._sessions["fanout-close-sid"] = session
    monkeypatch.setattr(server, "_teardown_popped_session", lambda *args, **kwargs: True)
    try:
        assert server._close_sessions_for_transport(first) == (0, 0)
        assert "fanout-close-sid" in server._sessions

        assert server._close_sessions_for_transport(second) == (1, 0)
        assert "fanout-close-sid" not in server._sessions
    finally:
        server._sessions.pop("fanout-close-sid", None)


def test_delegated_steer_authority_survives_client_attach_and_disconnect():
    first = _CollectingTransport("first")
    second = _CollectingTransport("second")
    session = _session(transport=first)
    server._sessions["sid-delegate-authority"] = session
    try:
        token = server.bind_transport(first)
        try:
            original = server._current_session_steer_authority(
                "sid-delegate-authority"
            )
        finally:
            server.reset_transport(token)

        server._attach_session_transport(session, second)
        server._detach_session_transport(session, first)

        token = server.bind_transport(second)
        try:
            resumed = server._current_session_steer_authority(
                "sid-delegate-authority"
            )
        finally:
            server.reset_transport(token)

        assert original[0] is resumed[0]
        assert original[1] is session
        assert resumed[1] is session
    finally:
        server._sessions.pop("sid-delegate-authority", None)


def test_gateway_approval_notification_includes_resolvable_request_id():
    from tools import approval

    notified = {}
    notified_event = threading.Event()
    result = {}

    def notify(data):
        notified.update(data)
        notified_event.set()

    worker = threading.Thread(
        target=lambda: result.update(
            approval._await_gateway_decision(
                "approval-notify-session",
                notify,
                {
                    "command": "rm one-file",
                    "description": "test",
                    "pattern_key": "test",
                    "pattern_keys": ["test"],
                },
            )
        )
    )
    worker.start()
    try:
        assert notified_event.wait(timeout=3.0)
        request_id = notified["request_id"]
        assert approval.resolve_gateway_approval(
            "approval-notify-session",
            "deny",
            request_id=request_id,
        ) == 1
        worker.join(timeout=3.0)
        assert result["resolved"] is True
        assert result["choice"] == "deny"
    finally:
        approval.unregister_gateway_notify("approval-notify-session")
        worker.join(timeout=3.0)

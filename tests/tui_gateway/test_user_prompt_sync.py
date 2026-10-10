"""Accepted user prompts fan out before model output, not just on hydration."""

import threading
import types

import pytest

from tui_gateway import server


class CollectingTransport:
    def __init__(self):
        self.frames = []

    def write(self, frame):
        self.frames.append(frame)
        return True

    def close(self):
        pass


@pytest.fixture
def clients(monkeypatch):
    desktop, mobile = CollectingTransport(), CollectingTransport()
    session = {
        "agent": types.SimpleNamespace(), "session_key": "stored", "running": False,
        "history": [], "history_lock": threading.Lock(), "history_version": 0,
        "attached_images": [], "cols": 80, "show_reasoning": False,
    }
    server._attach_session_transport(session, desktop)
    server._attach_session_transport(session, mobile)
    monkeypatch.setattr(server, "_sessions", {"shared": session})
    monkeypatch.setattr(server, "_sess_nowait", lambda *args: (session, None))
    monkeypatch.setattr(server, "_ensure_active_session_slot", lambda *args: None)
    monkeypatch.setattr(server, "_voice_mode_enabled", lambda: False)
    monkeypatch.setattr(server, "_load_dashboard_process_isolation_config", lambda: {})
    monkeypatch.setattr(server, "_session_uses_compute_host", lambda *args: False)
    monkeypatch.setattr(server, "_ensure_session_db_row", lambda *args: None)
    monkeypatch.setattr(server, "_persist_branch_seed", lambda *args: None)
    monkeypatch.setattr(server, "_start_agent_build", lambda *args: None)

    class DeferredThread:
        def __init__(self, *args, **kwargs):
            pass
        def start(self):
            pass
    monkeypatch.setattr(server.threading, "Thread", DeferredThread)
    return session, desktop, mobile


def submit():
    return server.handle_request({
        "id": "send", "method": "prompt.submit",
        "params": {"session_id": "shared", "text": "expanded model input",
                   "display_text": "/my-skill", "client_message_id": "user-client-1"},
    })


@pytest.mark.parametrize("mode", ["idle", "queue", "steer", "interrupt", "isolated"])
def test_accepted_prompt_reaches_both_clients_before_reply(clients, monkeypatch, mode):
    session, desktop, mobile = clients
    if mode == "isolated":
        monkeypatch.setattr(server, "_session_uses_compute_host", lambda *args: True)
        monkeypatch.setattr(server, "_submit_prompt_to_compute_host", lambda *args: server._ok("send", {"status": "streaming"}))
    elif mode != "idle":
        session["running"] = True
        server._start_inflight_turn(session, "initial prompt")
        session["agent"] = types.SimpleNamespace(
            steer=lambda text: True, redirect=lambda text: True,
            _supports_active_turn_redirect=True,
        )
        monkeypatch.setattr(server, "_load_busy_input_mode", lambda: mode)
    result = submit()["result"]
    expected_status = {"idle": "streaming", "isolated": "streaming", "queue": "queued", "steer": "steered", "interrupt": "redirected"}[mode]
    assert result["status"] == expected_status
    expected = {
        "type": "prompt.accepted", "session_id": "shared",
        "payload": {"message_id": "user-client-1", "text": "/my-skill", "status": expected_status},
    }
    for client in (desktop, mobile):
        frames = [frame["params"] for frame in client.frames if frame.get("method") == "event" and frame["params"]["type"] == "prompt.accepted"]
        assert frames == [expected]
    if mode == "steer":
        assert session["inflight_turn"]["corrections"] == ["expanded model input"]


def test_rejected_storage_write_is_not_broadcast_as_accepted(clients, monkeypatch):
    _, desktop, mobile = clients
    def fail(*args):
        raise RuntimeError("cannot persist session")
    monkeypatch.setattr(server, "_ensure_session_db_row", fail)
    assert submit().get("error")
    assert not desktop.frames and not mobile.frames


def test_rewind_is_not_echoed_as_a_second_user_bubble(clients):
    _, desktop, mobile = clients
    server._broadcast_submitted_prompt("shared", "replay", {"truncate_before_user_ordinal": 0}, "streaming")
    assert not desktop.frames and not mobile.frames


@pytest.mark.parametrize("method,building,status", [
    ("session.redirect", False, "redirected"),
    ("session.redirect", True, "queued"),
    ("session.steer", False, "steered"),
])
def test_direct_corrections_are_broadcast(clients, method, building, status):
    session, desktop, mobile = clients
    session["running"] = True
    session["agent"] = None if building else types.SimpleNamespace(
        steer=lambda text: True, redirect=lambda text: True,
        _supports_active_turn_redirect=True,
    )
    response = server.handle_request({"id": "correction", "method": method, "params": {
        "session_id": "shared", "text": "correction", "client_message_id": "user-correction",
    }})
    assert not response.get("error")
    for client in (desktop, mobile):
        assert client.frames[-1]["params"]["payload"] == {
            "message_id": "user-correction", "text": "correction", "status": status,
        }


def test_two_real_websockets_receive_user_prompts_in_both_directions(monkeypatch, tmp_path):
    import asyncio
    import json
    import socket

    import uvicorn
    import websockets
    from fastapi import FastAPI, WebSocket
    from hermes_state import SessionDB
    from tui_gateway.ws import handle_ws

    db = SessionDB(db_path=tmp_path / "state.db")
    db.create_session("stored-network", "desktop")
    session = server._deferred_session_record(
        "stored-network", cols=80, cwd=str(tmp_path), history=[], lease=None, source="desktop",
    )
    # A deterministic active agent accepts corrections without making a model
    # API call. Everything else is the real resume/RPC/fanout/WebSocket path.
    session["running"] = True
    session["agent"] = types.SimpleNamespace(
        redirect=lambda text: True, _supports_active_turn_redirect=True,
    )
    monkeypatch.setattr(server, "_sessions", {"shared-network": session})
    monkeypatch.setattr(server, "_get_db", lambda: db)
    monkeypatch.setattr(server, "_session_info", lambda *args: {})
    monkeypatch.setattr(server, "_ensure_active_session_slot", lambda *args: None)
    monkeypatch.setattr(server, "_load_busy_input_mode", lambda: "interrupt")
    monkeypatch.setattr(server, "_WS_ORPHAN_REAP_GRACE_S", 0)

    app = FastAPI()

    @app.websocket("/ws")
    async def endpoint(ws: WebSocket):
        await handle_ws(ws)

    async def exercise():
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        sock.listen()
        port = sock.getsockname()[1]
        host = uvicorn.Server(uvicorn.Config(app, log_level="error", lifespan="off"))
        task = asyncio.create_task(host.serve(sockets=[sock]))

        async def receive(ws, predicate):
            while True:
                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                if predicate(frame):
                    return frame

        try:
            while not host.started:
                if task.done():
                    await task
                await asyncio.sleep(0.01)
            async with websockets.connect(f"ws://127.0.0.1:{port}/ws") as desktop, websockets.connect(f"ws://127.0.0.1:{port}/ws") as mobile:
                peers = (desktop, mobile)
                for index, ws in enumerate(peers):
                    rid = f"resume-{index}"
                    await ws.send(json.dumps({"id": rid, "method": "session.resume", "params": {"session_id": "stored-network", "omit_messages": True}}))
                    response = await receive(ws, lambda frame: frame.get("id") == rid)
                    assert response["result"]["session_id"] == "shared-network"
                for index, sender in enumerate(peers):
                    message_id = f"user-network-{index}"
                    await sender.send(json.dumps({"id": message_id, "method": "prompt.submit", "params": {
                        "session_id": "shared-network", "text": f"from peer {index}", "client_message_id": message_id,
                    }}))
                    for peer in peers:
                        frame = await receive(peer, lambda frame: frame.get("params", {}).get("type") == "prompt.accepted")
                        assert frame["params"]["payload"] == {
                            "message_id": message_id, "text": f"from peer {index}", "status": "redirected",
                        }
        finally:
            host.should_exit = True
            await asyncio.wait_for(task, timeout=5)
            sock.close()

    try:
        asyncio.run(asyncio.wait_for(exercise(), timeout=20))
    finally:
        db.close()

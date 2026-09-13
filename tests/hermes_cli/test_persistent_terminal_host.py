"""Real authenticated websocket -> independent Node PTY, isolated HERMES_HOME."""
import os
from pathlib import Path
import shutil
import subprocess
import time

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from hermes_cli import web_server
from hermes_constants import get_hermes_home


@pytest.fixture
def host(monkeypatch):
    root = Path(__file__).resolve().parents[2]
    bundle = root / "apps" / "desktop" / "dist" / "terminal-host"
    node = str(bundle / ("node.exe" if os.name == "nt" else "node"))
    cli = bundle / "package" / "src" / "cli.mjs"
    if not Path(node).is_file() or not cli.is_file():
        pytest.skip("Build the native terminal-host bundle first")
    home = get_hermes_home()
    directory = home / "terminal-host" / "runtime"
    subprocess.run([node, str(cli), "start", "--dir", str(directory)], check=True, capture_output=True, timeout=20)
    monkeypatch.setattr(web_server.app.state, "public_auth_disabled", False, raising=False)
    monkeypatch.setattr(web_server.app.state, "auth_required", False, raising=False)
    monkeypatch.setattr(web_server.app.state, "bound_host", None, raising=False)
    try:
        yield home
    finally:
        subprocess.run([node, str(cli), "stop", "--force", "--dir", str(directory)], check=True, capture_output=True, timeout=20)


def rpc(ws, method, params):
    ws.send_json({"id": 1, "method": method, "params": params})
    response = ws.receive_json()
    assert "error" not in response, response
    return response["result"]


def test_auth_rejected_before_host_lookup(monkeypatch):
    monkeypatch.setattr(web_server.app.state, "public_auth_disabled", False, raising=False)
    monkeypatch.setattr(web_server.app.state, "auth_required", False, raising=False)
    with TestClient(web_server.app, client=("127.0.0.1", 50000)) as client:
        with pytest.raises(WebSocketDisconnect) as error:
            with client.websocket_connect("/api/persistent-terminal?token=wrong"):
                pass
        assert error.value.code == 4401


@pytest.mark.live_system_guard_bypass
def test_disconnect_and_new_backend_client_preserve_process(host, tmp_path):
    url = "/api/persistent-terminal?token=" + web_server._SESSION_TOKEN
    with TestClient(web_server.app, client=("127.0.0.1", 50000)) as client:
        with client.websocket_connect(url) as ws:
            ready = ws.receive_json()
            assert ready["protocol"] == 2
            created = rpc(ws, "create", {"scope": ready["scope"], "requestId": "durable-tab", "cwd": str(tmp_path)})
            reference = {"scope": ready["scope"], "epoch": ready["epoch"], "terminalId": created["terminalId"]}
            attached = rpc(ws, "attach", reference)
            pid = attached["pid"]
            rpc(ws, "input", {**attached["identity"], "data": ("set " if os.name == "nt" else "") + "HERMES_TEST_PROOF=preserved\r"})
    # This is a new backend client lifecycle; no previous websocket/session object survives.
    with TestClient(web_server.app, client=("127.0.0.1", 50000)) as client:
        with client.websocket_connect(url) as ws:
            assert ws.receive_json()["epoch"] == reference["epoch"]
            again = rpc(ws, "attach", reference)
            assert again["pid"] == pid
            os.kill(pid, 0)
            command = "echo PROOF_%HERMES_TEST_PROOF%\r" if os.name == "nt" else "printf 'PROOF_%s\\n' \"$HERMES_TEST_PROOF\"\r"
            rpc(ws, "input", {**again["identity"], "data": command})
            after = again["snapshot"]["seq"]
            output = ""
            deadline = time.monotonic() + 5
            while "PROOF_preserved" not in output and time.monotonic() < deadline:
                response = rpc(ws, "read", {**reference, "after": after})
                for event in response["events"]:
                    output += event.get("data", "")
                    after = event["seq"]
                time.sleep(.02)
            assert "PROOF_preserved" in output
            ws.send_json({"id": 2, "method": "terminate", "params": {**reference, "scope": "profile/other"}})
            assert ws.receive_json()["error"] == "OWNER_MISMATCH"
            rpc(ws, "terminate", reference)

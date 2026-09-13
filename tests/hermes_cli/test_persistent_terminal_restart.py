"""Real backend-process restart acceptance for the independent PTY host."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

import httpx
import pytest
from websockets.sync.client import connect


@pytest.mark.live_system_guard_bypass
def test_real_backend_process_restart_keeps_the_shell(tmp_path, monkeypatch):
    from hermes_constants import get_hermes_home
    root = Path(__file__).resolve().parents[2]
    bundle = root / 'apps/desktop/dist/terminal-host'
    node = bundle / ('node.exe' if os.name == 'nt' else 'node')
    cli = bundle / 'package/src/cli.mjs'
    if not node.is_file():
        pytest.skip('Build the native terminal-host bundle first')
    directory = get_hermes_home() / 'terminal-host/runtime'
    subprocess.run([str(node), str(cli), 'start', '--dir', str(directory)], check=True, capture_output=True, timeout=20)
    with socket.socket() as reserve:
        reserve.bind(('127.0.0.1', 0))
        port = reserve.getsockname()[1]
    server = None
    def start():
        code = ("from hermes_cli import web_server; "
                "web_server._SESSION_TOKEN='terminal-restart-test'; "
                "web_server.app.state.public_auth_disabled=False; "
                "web_server.app.state.auth_required=False; "
                "import uvicorn; uvicorn.run(web_server.app, host='127.0.0.1', port=" + str(port) + ", log_level='error')")
        process = subprocess.Popen([sys.executable, '-c', code], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                assert process.poll() is None, 'backend exited before readiness'
                try:
                    httpx.get(f'http://127.0.0.1:{port}/', timeout=.5, trust_env=False)
                    return process
                except httpx.HTTPError:
                    time.sleep(.05)
            raise AssertionError('backend did not become reachable')
        except BaseException:
            process.terminate(); process.wait(timeout=10)
            raise
    def rpc(ws, method, params):
        ws.send(json.dumps({'id': 1, 'method': method, 'params': params}))
        result = json.loads(ws.recv(timeout=10))
        assert 'error' not in result, result
        return result['result']
    try:
        server = start()
        first_backend_pid = server.pid
        url = f'ws://127.0.0.1:{port}/api/persistent-terminal?token=terminal-restart-test'
        with connect(url, max_size=None, proxy=None) as ws:
            hello = json.loads(ws.recv(timeout=10))
            created = rpc(ws, 'create', {'scope': hello['scope'], 'requestId': 'backend-restart', 'cwd': str(tmp_path)})
            reference = {'scope': hello['scope'], 'epoch': hello['epoch'], 'terminalId': created['terminalId']}
            attached = rpc(ws, 'attach', reference)
            pid = attached['pid']
            command = ('set ' if os.name == 'nt' else '') + 'HERMES_RESTART_PROOF=kept\r'
            rpc(ws, 'input', {**attached['identity'], 'data': command})
        server.terminate(); server.wait(timeout=10)
        os.kill(pid, 0)
        server = start()
        assert server.pid != first_backend_pid
        with connect(url, max_size=None, proxy=None) as ws:
            assert json.loads(ws.recv(timeout=10))['epoch'] == reference['epoch']
            attached = rpc(ws, 'attach', reference)
            assert attached['pid'] == pid
            command = 'echo CHECK_%HERMES_RESTART_PROOF%\r' if os.name == 'nt' else 'printf "CHECK_%s\\n" "$HERMES_RESTART_PROOF"\r'
            rpc(ws, 'input', {**attached['identity'], 'data': command})
            sequence = attached['snapshot']['seq']
            output = ''
            deadline = time.monotonic() + 5
            while 'CHECK_kept' not in output and time.monotonic() < deadline:
                data = rpc(ws, 'read', {**reference, 'after': sequence})
                for event in data['events']:
                    output += event.get('data', '')
                    sequence = event['seq']
                time.sleep(.02)
            assert 'CHECK_kept' in output
            rpc(ws, 'terminate', reference)
    finally:
        if server and server.poll() is None:
            server.terminate(); server.wait(timeout=10)
        subprocess.run([str(node), str(cli), 'stop', '--force', '--dir', str(directory)], check=True, capture_output=True, timeout=20)

"""Exercise actual auth routes and subprocess cleanup without requiring Chromium."""
import asyncio
import json
import sys
from urllib.parse import urlencode

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from hermes_cli import remote_browser, web_server


@pytest.fixture
def client(monkeypatch, _isolate_hermes_home):
    monkeypatch.setattr(web_server.app.state, 'public_auth_disabled', False, raising=False)
    monkeypatch.setattr(web_server.app.state, 'auth_required', False, raising=False)
    monkeypatch.setattr(web_server.app.state, 'bound_host', None, raising=False)
    with TestClient(web_server.app, client=('127.0.0.1', 50000)) as value:
        yield value


@pytest.fixture
def processes(monkeypatch):
    # Actual OS subprocess pipe/termination path; only Chromium substituted.
    import hermes_constants
    monkeypatch.setattr(hermes_constants, 'find_node_executable', lambda _: sys.executable)
    monkeypatch.setenv('REMOTE_BROWSER_TEST_SECRET', 'must-not-reach-chromium')
    original = asyncio.create_subprocess_exec
    spawned = []
    async def spawn(*args, **kwargs):
        assert 'REMOTE_BROWSER_TEST_SECRET' not in kwargs['env']
        assert 'NODE_OPTIONS' not in kwargs['env']
        code = "import json,sys,time; print(json.dumps({'type':'ready','protocol':1}),flush=True); time.sleep(60)"
        process = await original(sys.executable, '-c', code, **kwargs)
        spawned.append(process)
        return process
    monkeypatch.setattr(remote_browser.asyncio, 'create_subprocess_exec', spawn)
    return spawned


@pytest.mark.parametrize('params,headers,bound,expected', [
    ({'token': 'wrong'}, {}, None, 4401),
    ({'profile': '../escape'}, {}, None, 4400),
    ({'profile': 'missing-owner'}, {}, None, 4400),
    ({}, {'host': '127.0.0.1', 'origin': 'https://attacker.example'}, '127.0.0.1', 4403),
])
def test_guards_before_worker(client, monkeypatch, params, headers, bound, expected):
    async def forbidden(ws):
        pytest.fail('rejected request reached browser spawn')
    monkeypatch.setattr(remote_browser, 'serve_remote_browser', forbidden)
    monkeypatch.setattr(web_server.app.state, 'bound_host', bound)
    query = urlencode({'token': web_server._SESSION_TOKEN, **params})
    with pytest.raises(WebSocketDisconnect) as caught:
        with client.websocket_connect('/api/remote-browser?' + query, headers=headers):
            pass
    assert caught.value.code == expected


def test_rejects_remote_peer_on_loopback_binding(client, monkeypatch):
    monkeypatch.setattr(web_server.app.state, 'public_auth_disabled', True)
    monkeypatch.setattr(web_server.app.state, 'bound_host', '127.0.0.1')
    async def forbidden(ws):
        pytest.fail('remote peer reached browser spawn')
    monkeypatch.setattr(remote_browser, 'serve_remote_browser', forbidden)
    with TestClient(web_server.app, client=('192.0.2.50', 50000)) as remote:
        with pytest.raises(WebSocketDisconnect) as caught:
            with remote.websocket_connect('/api/remote-browser', headers={'host': '127.0.0.1'}):
                pass
    assert caught.value.code == 4408


def test_disconnect_reaps_worker_and_releases_capacity(client, processes):
    with client.websocket_connect('/api/remote-browser?token=' + web_server._SESSION_TOKEN) as ws:
        assert ws.receive_json()['protocol'] == 1
        assert len(remote_browser._active) == 1
        assert processes[0].returncode is None
    assert processes[0].returncode is not None
    assert not remote_browser._active


def test_invalid_command_not_forwarded(client, processes):
    with client.websocket_connect('/api/remote-browser?token=' + web_server._SESSION_TOKEN) as ws:
        ws.receive_json()
        ws.send_json({'type': 'navigate', 'url': 'file:///etc/passwd'})
        assert ws.receive_json() == {'type': 'error', 'error': 'Invalid browser command'}
    assert processes[0].returncode is not None


def test_capacity_limit_before_process_spawn(client, processes, monkeypatch):
    monkeypatch.setattr(remote_browser, 'MAX_SESSIONS', 0)
    with pytest.raises(WebSocketDisconnect) as caught:
        with client.websocket_connect('/api/remote-browser?token=' + web_server._SESSION_TOKEN):
            pass
    assert caught.value.code == 4429
    assert not processes


def test_idle_timeout_reaps_worker(client, processes, monkeypatch):
    monkeypatch.setattr(remote_browser, 'IDLE_SECONDS', 0.05)
    with client.websocket_connect('/api/remote-browser?token=' + web_server._SESSION_TOKEN) as ws:
        assert ws.receive_json()['type'] == 'ready'
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()
    assert processes[0].returncode is not None
    assert not remote_browser._active


def test_frame_acks_do_not_extend_idle_lease(processes, monkeypatch):
    monkeypatch.setattr(remote_browser, 'IDLE_SECONDS', 0.05)
    monkeypatch.setattr(remote_browser, 'MAX_LIFETIME_SECONDS', 0.3)
    class AckSocket:
        count = 0
        async def accept(self): pass
        async def send_text(self, text): pass
        async def close(self, **kwargs): pass
        async def receive_text(self):
            await asyncio.sleep(.01)
            self.count += 1
            return json.dumps({'type': 'ack'})
    ws = AckSocket()
    asyncio.run(remote_browser.serve_remote_browser(ws))
    # With the bug, continuous ACKs run until the lifetime (about 30 ACKs).
    assert ws.count < 10
    assert processes[0].returncode is not None
    assert not remote_browser._active


def test_lifetime_reaps_active_worker(client, processes, monkeypatch):
    monkeypatch.setattr(remote_browser, 'MAX_LIFETIME_SECONDS', 0.05)
    with client.websocket_connect('/api/remote-browser?token=' + web_server._SESSION_TOKEN) as ws:
        assert ws.receive_json()['type'] == 'ready'
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()
    assert processes[0].returncode is not None
    assert not remote_browser._active


def test_input_rate_is_bounded(client, processes):
    with client.websocket_connect('/api/remote-browser?token=' + web_server._SESSION_TOKEN) as ws:
        ws.receive_json()
        for _ in range(121):
            ws.send_json({'type': 'ack'})
        with pytest.raises(WebSocketDisconnect) as caught:
            ws.receive_json()
        assert caught.value.code == 4429
    assert processes[0].returncode is not None
    assert not remote_browser._active


def test_oauth_ticket_is_single_use_socket_owner(client, processes, monkeypatch):
    from hermes_cli.dashboard_auth.ws_tickets import mint_ticket
    monkeypatch.setattr(web_server.app.state, 'auth_required', True)
    url = '/api/remote-browser?ticket=' + mint_ticket(user_id='browser-owner', provider='test')
    with client.websocket_connect(url) as ws:
        assert ws.receive_json()['type'] == 'ready'
    with pytest.raises(WebSocketDisconnect) as caught:
        with client.websocket_connect(url):
            pass
    assert caught.value.code == 4401
    assert len(processes) == 1
    assert processes[0].returncode is not None


def test_start_failure_releases_capacity(client, monkeypatch):
    import hermes_constants
    monkeypatch.setattr(hermes_constants, 'find_node_executable', lambda _: None)
    with pytest.raises(WebSocketDisconnect) as caught:
        with client.websocket_connect('/api/remote-browser?token=' + web_server._SESSION_TOKEN):
            pass
    assert caught.value.code == 4404
    assert not remote_browser._active

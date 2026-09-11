"""Authenticated desktop shell transport uses the real PTY with isolated home."""
from urllib.parse import urlencode

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from hermes_cli import web_server


@pytest.fixture
def client(monkeypatch, _isolate_hermes_home):
    monkeypatch.setattr(web_server.app.state, 'public_auth_disabled', False, raising=False)
    monkeypatch.setattr(web_server.app.state, 'auth_required', False, raising=False)
    monkeypatch.setattr(web_server.app.state, 'bound_host', None, raising=False)
    client = TestClient(web_server.app, client=('127.0.0.1', 50000))
    yield client
    client.close()


def test_rejects_bad_auth_before_spawn(client, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("invalid auth reached spawn")
    monkeypatch.setattr(web_server.PtyBridge, "spawn", forbidden)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect('/api/terminal?token=wrong'):
            pass
    assert exc.value.code == 4401


def test_real_shell_cwd_resize_and_exit(client, tmp_path):
    query = urlencode(dict(token=web_server._SESSION_TOKEN, cwd=str(tmp_path), cols=91, rows=31))
    with client.websocket_connect('/api/terminal?' + query) as ws:
        assert ws.receive_json()['type'] == 'ready'
        ws.send_text("printf 'OWNER_%s\\n' \"$PWD\"; stty size\r")
        output = b''
        while str(tmp_path).encode() not in output or b'31 91' not in output:
            output += ws.receive_bytes()
        ws.send_text('\x1b[RESIZE:101;41]')
        ws.send_text('stty size\r')
        output = b''
        while b'41 101' not in output:
            output += ws.receive_bytes()
        ws.send_text('exit\r')
        with pytest.raises(WebSocketDisconnect):
            while True:
                ws.receive_bytes()


@pytest.mark.parametrize('params,code', [({'profile': '../escape'}, 4400), ({'profile': 'missing-owner'}, 4400), ({'cols': 'bad'}, 4400)])
def test_invalid_owner_or_size_fails_closed(client, params, code):
    query = urlencode(dict(token=web_server._SESSION_TOKEN, **params))
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect('/api/terminal?' + query):
            pass
    assert exc.value.code == code


def test_explicit_trusted_lan_no_auth_can_open_shell(client, monkeypatch):
    monkeypatch.setattr(web_server.app.state, 'public_auth_disabled', True, raising=False)
    monkeypatch.setattr(web_server.app.state, 'bound_host', '192.168.68.64')
    with client.websocket_connect('/api/terminal', headers={'host': '192.168.68.64'}) as ws:
        assert ws.receive_json()['protocol'] == 1


@pytest.mark.parametrize('params', [{'cwd': '/nonexistent/hermes-test-directory'}, {'cwd': ''}])
def test_explicit_invalid_cwd_never_spawns(client, monkeypatch, params):
    def forbidden(*args, **kwargs):
        pytest.fail('invalid cwd reached spawn')
    monkeypatch.setattr(web_server.PtyBridge, 'spawn', forbidden)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect('/api/terminal?' + urlencode(dict(token=web_server._SESSION_TOKEN, **params))):
            pass
    assert exc.value.code == 4400


@pytest.mark.parametrize('credential', ['missing', 'expired'])
def test_gated_missing_or_expired_ticket_never_spawns(client, monkeypatch, credential):
    from hermes_cli.dashboard_auth import ws_tickets
    monkeypatch.setattr(web_server.app.state, 'auth_required', True)
    def forbidden(*args, **kwargs):
        pytest.fail('invalid auth reached spawn')
    monkeypatch.setattr(web_server.PtyBridge, 'spawn', forbidden)
    query = ''
    if credential == 'expired':
        ticket = ws_tickets.mint_ticket(user_id='test', provider='test')
        expiry, info = ws_tickets._tickets[ticket]
        ws_tickets._tickets[ticket] = (expiry - 60, info)
        query = '?ticket=' + ticket
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect('/api/terminal' + query):
            pass
    assert exc.value.code == 4401


@pytest.mark.parametrize('bound,headers,code', [
    ('192.168.68.64', {'host': 'attacker.example'}, 4403),
    ('192.168.68.64', {'host': '192.168.68.64', 'origin': 'https://attacker.example'}, 4403),
    ('127.0.0.1', {'host': '127.0.0.1'}, 4408),
])
def test_auth_disabled_preserves_host_origin_peer_guards(client, monkeypatch, bound, headers, code):
    monkeypatch.setattr(web_server.app.state, 'public_auth_disabled', True)
    monkeypatch.setattr(web_server.app.state, 'bound_host', bound)
    def forbidden(*args, **kwargs):
        pytest.fail('rejected request reached spawn')
    monkeypatch.setattr(web_server.PtyBridge, 'spawn', forbidden)
    client = TestClient(web_server.app, client=('192.0.2.50', 50000))
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect('/api/terminal', headers=headers):
            pass
    assert exc.value.code == code


def test_rejects_cross_origin(client, monkeypatch):
    monkeypatch.setattr(web_server.app.state, 'bound_host', '127.0.0.1')
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect('/api/terminal?token=' + web_server._SESSION_TOKEN,
                                      headers={'host': '127.0.0.1', 'origin': 'https://attacker.example'}):
            pass
    assert exc.value.code == 4403


def test_ticket_is_single_use_and_disconnect_reaps_shell(client, monkeypatch):
    from hermes_cli.dashboard_auth.ws_tickets import mint_ticket
    monkeypatch.setattr(web_server.app.state, 'auth_required', True)
    spawned = []
    original_spawn = web_server.PtyBridge.spawn

    def spawn(*args, **kwargs):
        bridge = original_spawn(*args, **kwargs)
        spawned.append(bridge)
        return bridge

    monkeypatch.setattr(web_server.PtyBridge, 'spawn', spawn)
    ticket = mint_ticket(user_id='test-owner', provider='test')
    url = '/api/terminal?ticket=' + ticket
    with client.websocket_connect(url) as ws:
        assert ws.receive_json()['protocol'] == 1
        assert spawned[0].is_alive()
    assert not spawned[0].is_alive()
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(url):
            pass
    assert exc.value.code == 4401
    assert len(spawned) == 1


def test_named_owner_home_survives_foreground_change(client, monkeypatch):
    from hermes_constants import get_hermes_home
    home = get_hermes_home()
    owner = home / 'profiles' / 'owner-a'
    owner.mkdir(parents=True)
    (owner / 'config.yaml').write_text('{}')
    query = urlencode(dict(token=web_server._SESSION_TOKEN, profile='owner-a'))
    with client.websocket_connect('/api/terminal?' + query) as ws:
        assert ws.receive_json()['type'] == 'ready'
        monkeypatch.setenv('HERMES_HOME', str(home / 'profiles' / 'owner-b'))
        ws.send_text("printf 'BOUND_%s\\n' \"$HERMES_HOME\"\r")
        output = b''
        while ('BOUND_' + str(owner)).encode() not in output:
            output += ws.receive_bytes()


@pytest.mark.live_system_guard_bypass
@pytest.mark.parametrize('background', [False, True])
def test_disconnect_reaps_interactive_descendant(client, monkeypatch, tmp_path, background):
    import os
    import psutil
    import shlex
    import sys
    import time

    monkeypatch.setenv('SHELL', '/bin/bash')
    pidfile = tmp_path / 'job.pid'
    script = (
        "import os,signal,time; "
        "signal.signal(signal.SIGHUP, signal.SIG_IGN); "
        "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
        f"open({str(pidfile)!r}, 'w').write(str(os.getpid())); "
        "time.sleep(120)"
    )
    child = None
    try:
        with client.websocket_connect('/api/terminal?token=' + web_server._SESSION_TOKEN) as ws:
            assert ws.receive_json()['type'] == 'ready'
            command = shlex.quote(sys.executable) + ' -c ' + shlex.quote(script)
            ws.send_text(command + (' &' if background else '') + '\r')
            deadline = time.monotonic() + 5
            while not pidfile.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            assert pidfile.exists()
            child = psutil.Process(int(pidfile.read_text()))
            assert os.getpgid(child.pid) != os.getsid(child.pid)
        assert not child.is_running() or child.status() == psutil.STATUS_ZOMBIE
    finally:
        if child and child.is_running():
            child.kill()

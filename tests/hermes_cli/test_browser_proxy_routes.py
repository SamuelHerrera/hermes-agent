"""Real Python -> Node capability and authenticated route integration."""
import json
import shutil
from pathlib import Path

import httpx
import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from hermes_cli import web_server


@pytest.fixture
def client(monkeypatch, _isolate_hermes_home):
    monkeypatch.setattr(web_server.app.state, 'public_auth_disabled', False, raising=False)
    monkeypatch.setattr(web_server.app.state, 'auth_required', False, raising=False)
    monkeypatch.setattr(web_server.app.state, 'bound_host', None, raising=False)
    from hermes_constants import get_hermes_home
    (get_hermes_home() / 'config.yaml').write_text('desktop:\n  browser_proxy_origin: https://www.wikipedia.org\n  browser_proxy_port: 0\n')
    # Shared CI Python lanes do not install optional Node proxy dependencies.
    root = Path(web_server.__file__).with_name('browser_proxy')
    if not shutil.which('node') or not (root / 'node_modules/@mercuryworkshop/scramjet').exists():
        pytest.skip('optional Node proxy dependency integration lane not installed')
    with TestClient(web_server.app, client=('127.0.0.1', 50000), base_url='https://www.python.org') as value:
        yield value
        process = web_server.app.state.browser_proxy.process
    if process is not None:
        assert process.returncode is not None, 'Backend shutdown must reap its proxy helper'


def headers(**extra):
    return {'X-Hermes-Session-Token': web_server._SESSION_TOKEN, 'Origin': 'https://www.python.org', **extra}


def test_capability_requires_auth_and_exact_parent_origin(client):
    assert client.post('/api/browser-proxy/bootstrap', headers={'Origin': 'https://www.python.org'}).status_code == 401
    for origin in ['', 'null', 'https://evil.example.org', 'https://www.python.org/path', 'http://www.python.org']:
        assert client.post('/api/browser-proxy/bootstrap', headers=headers(Origin=origin)).status_code == 403
    response = client.post('/api/browser-proxy/bootstrap', headers=headers())
    assert response.status_code == 200, response.text
    value = response.json()
    assert value['origin'] == 'https://www.wikipedia.org'
    assert len(value['ticket']) == 43
    assert web_server._SESSION_TOKEN not in json.dumps(value)
    assert response.headers['cache-control'] == 'no-store'
    proxy = web_server.app.state.browser_proxy
    process = proxy.process
    assert process.returncode is None
    # Only ticket exchanges are HTTP-exposed on the helper, never management.
    helper = f'http://127.0.0.1:{proxy.port}'
    with httpx.Client(trust_env=False) as http:
        result = http.post(helper + '/bootstrap', headers={'Host': 'www.wikipedia.org', 'Origin': value['origin']}, json={'ticket': value['ticket']})
        assert result.status_code == 200
        cookie = result.headers['set-cookie']
        for required in ['__Host-HermesProxy=', 'HttpOnly', 'Secure', 'SameSite=None', 'Partitioned', 'Path=/']:
            assert required in cookie
        assert 'Domain=' not in cookie
        assert http.post(helper + '/bootstrap', headers={'Host': 'www.wikipedia.org', 'Origin': value['origin']}, json={'ticket': value['ticket']}).status_code == 401
        assert http.get(helper + '/admin/mint', headers={'Host': 'www.wikipedia.org'}).status_code == 404
    client._proxy_test_process = process


def test_proxy_origin_never_reaches_hermes_api_or_websocket_even_when_auth_disabled(client, monkeypatch):
    monkeypatch.setattr(web_server.app.state, 'public_auth_disabled', True)
    assert client.post('/api/browser-proxy/bootstrap', headers={'Origin': 'https://www.python.org'}).status_code == 401
    assert client.get('/api/status', headers={'Origin': 'https://www.wikipedia.org'}).status_code == 403
    assert client.get('/api/status', headers={'Origin': 'https://www.wikipedia.org:9443'}).status_code == 403
    assert client.post('/api/browser-proxy/bootstrap', headers=headers()).status_code == 200
    client.portal.call(web_server.app.state.browser_proxy.stop)
    monkeypatch.setattr(web_server.app.state, 'browser_proxy_origin', 'https://replacement.example.net')
    assert client.get('/api/status', headers={'Origin': 'https://www.wikipedia.org'}).status_code == 403
    assert client.get('/api/status', headers={'Sec-Fetch-Site': 'cross-site'}).status_code == 403
    with pytest.raises(WebSocketDisconnect) as caught:
        with client.websocket_connect('/api/ws', headers={'Origin': 'https://www.wikipedia.org'}):
            pass
    assert caught.value.code == 4403
    with pytest.raises(WebSocketDisconnect) as caught:
        with client.websocket_connect('/api/remote-browser'):
            pass
    assert caught.value.code == 4404


def test_parent_frame_policy_cannot_allow_proxy_escape_to_hermes(client):
    response = client.get('/desktop/')
    # The renderer need not be installed for response policy verification.
    policy = response.headers['content-security-policy']
    assert 'frame-src https://www.wikipedia.org blob: data:' in policy
    assert "'self'" not in policy


def test_same_registrable_site_is_rejected_by_real_helper(client):
    from hermes_constants import get_hermes_home
    (get_hermes_home() / 'config.yaml').write_text('desktop:\n  browser_proxy_origin: https://browser.python.org\n  browser_proxy_port: 0\n')
    response = client.post('/api/browser-proxy/bootstrap', headers=headers())
    assert response.status_code == 503
    assert 'isolation' in response.text

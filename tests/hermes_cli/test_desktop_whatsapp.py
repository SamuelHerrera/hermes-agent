import asyncio
import pytest
import yaml


def test_behavior_controls_roundtrip_into_runtime():
    from hermes_cli import web_server as ws
    from hermes_constants import get_hermes_home
    from gateway.config import load_gateway_config, Platform
    from plugins.platforms.whatsapp.adapter import WhatsAppAdapter
    home = get_hermes_home()
    (home / 'config.yaml').write_text('platforms:\n  whatsapp:\n    enabled: true\n    extra:\n      dm_policy: allowlist\n      allow_from: [owner]\n')
    fields = dict(send_read_receipts=True, reply_prefix='', group_policy='allowlist',
                  group_allow_from='123@g.us', require_mention=True,
                  free_response_chats='456@g.us')
    asyncio.run(ws.update_desktop_whatsapp(ws.DesktopWhatsAppUpdate(**fields)))
    settings = asyncio.run(ws.get_desktop_whatsapp())['settings']
    for key, value in fields.items():
        assert settings[key] == value
    runtime = load_gateway_config().platforms[Platform.WHATSAPP]
    adapter = WhatsAppAdapter(runtime)
    assert adapter._send_read_receipts is True
    assert adapter._reply_prefix == ''
    assert adapter._group_policy == 'allowlist'
    assert adapter._group_allow_from == {'123@g.us'}
    assert adapter._whatsapp_require_mention() is True
    assert adapter._whatsapp_free_response_chats() == {'456@g.us'}
    assert adapter._allow_from == {'owner'}


def test_mention_patterns_validate_and_reach_adapter():
    from hermes_cli import web_server as ws
    from hermes_constants import get_hermes_home
    from gateway.config import load_gateway_config, Platform
    from plugins.platforms.whatsapp.adapter import WhatsAppAdapter
    from pydantic import ValidationError
    (get_hermes_home() / 'config.yaml').write_text('platforms:\n  whatsapp:\n    enabled: true\n')
    with pytest.raises(ValidationError):
        ws.DesktopWhatsAppUpdate(mention_patterns=['['])
    asyncio.run(ws.update_desktop_whatsapp(ws.DesktopWhatsAppUpdate(mention_patterns=['hey hermes', '^bot:'])))
    assert asyncio.run(ws.get_desktop_whatsapp())['settings']['mention_patterns'] == ['hey hermes', '^bot:']
    adapter = WhatsAppAdapter(load_gateway_config().platforms[Platform.WHATSAPP])
    assert any(p.search('HEY HERMES') for p in adapter._mention_patterns)


@pytest.mark.parametrize('field,old,new', [
    ('send_read_receipts', True, False), ('reply_prefix', 'old', ''),
    ('group_policy', 'open', 'disabled'), ('group_allow_from', ['old@g.us'], ''),
    ('require_mention', True, False), ('mention_patterns', ['old'], []),
])
def test_behavior_edits_clear_shadowing_values_without_touching_other_fields(field, old, new):
    import copy
    from hermes_cli import web_server as ws
    from hermes_constants import get_hermes_home
    from gateway.config import load_gateway_config, Platform
    block = {field: old, 'extra': {field: old}, 'dm_policy': 'allowlist', 'allow_from': ['owner']}
    cfg = {'whatsapp': copy.deepcopy(block), 'platforms': {'whatsapp': copy.deepcopy(block)},
           'gateway': {'platforms': {'whatsapp': copy.deepcopy(block)}}}
    home = get_hermes_home()
    (home / 'config.yaml').write_text(yaml.safe_dump(cfg))
    before = asyncio.run(ws.get_desktop_whatsapp())['settings']
    expected_old = ','.join(old) if field == 'group_allow_from' else old
    assert before[field] == expected_old
    asyncio.run(ws.update_desktop_whatsapp(ws.DesktopWhatsAppUpdate(**{field: new})))
    after = asyncio.run(ws.get_desktop_whatsapp())['settings']
    assert after == {**before, field: new}
    runtime = load_gateway_config().platforms[Platform.WHATSAPP]
    assert runtime.extra[field] == ([] if field == 'group_allow_from' else new)
    assert runtime.extra['allow_from'] == ['owner']


@pytest.mark.parametrize('layout', ['platforms', 'legacy', 'gateway-platforms', 'gateway-direct'])
def test_settings_reads_match_runtime_precedence(layout):
    from hermes_cli import web_server as ws
    from hermes_constants import get_hermes_home
    from gateway.config import load_gateway_config, Platform
    block = {'enabled': True, 'dm_policy': 'open', 'allow_from': ['direct'],
             'extra': {'dm_policy': 'disabled', 'allow_from': ['extra'], 'mode': 'bot'}}
    cfg = {'platforms': {'whatsapp': block}}
    if layout == 'legacy':
        cfg['whatsapp'] = {'enabled': False, 'dm_policy': 'allowlist', 'allow_from': []}
    elif layout == 'gateway-platforms':
        cfg['gateway'] = {'platforms': {'whatsapp': {'dm_policy': 'pairing', 'allow_from': ['nested']}}}
    elif layout == 'gateway-direct':
        cfg['gateway'] = {'whatsapp': {'enabled': False, 'extra': {'mode': 'self-chat'}}}
    (get_hermes_home() / 'config.yaml').write_text(yaml.safe_dump(cfg))
    settings = asyncio.run(ws.get_desktop_whatsapp())['settings']
    runtime = load_gateway_config().platforms[Platform.WHATSAPP]
    assert settings['enabled'] == runtime.enabled
    assert settings['dm_policy'] == runtime.extra['dm_policy']
    assert settings['allowed_users'] == ','.join(runtime.extra['allow_from'])
    assert settings['mode'] == runtime.extra['mode']


@pytest.mark.parametrize('field,value', [('enabled', False), ('dm_policy', 'disabled'), ('allowed_users', ''), ('mode', 'self-chat')])
def test_save_replaces_only_edited_field_in_all_yaml_locations(field, value):
    import copy
    from hermes_cli import web_server as ws
    from hermes_constants import get_hermes_home
    from gateway.config import load_gateway_config, Platform
    block = {'enabled': True, 'dm_policy': 'open', 'allow_from': ['old'],
             'allowFrom': ['alias'], 'mode': 'bot', 'keep': 'untouched',
             'extra': {'enabled': True, 'dm_policy': 'open', 'allow_from': ['old'],
                       'allowFrom': ['alias'], 'mode': 'bot', 'keep': 'extra'}}
    cfg = {'agent': {'max_turns': 17}, 'whatsapp': copy.deepcopy(block), 'platforms': {'whatsapp': copy.deepcopy(block)},
           'gateway': {'platforms': {'whatsapp': copy.deepcopy(block)}, 'whatsapp': copy.deepcopy(block)}}
    home = get_hermes_home()
    (home / 'config.yaml').write_text(yaml.safe_dump(cfg))
    env = {'enabled': 'WHATSAPP_ENABLED=true', 'mode': 'WHATSAPP_MODE=bot',
           'dm_policy': 'WHATSAPP_DM_POLICY=open', 'allowed_users': 'WHATSAPP_ALLOWED_USERS=old'}
    (home / '.env').write_text('\n'.join(env.values()) + '\n')
    asyncio.run(ws.update_desktop_whatsapp(ws.DesktopWhatsAppUpdate(**{field: value})))
    saved = yaml.safe_load((home / 'config.yaml').read_text())
    keys = {'allow_from', 'allowFrom'} if field == 'allowed_users' else {field}
    def without_edited(data):
        data = copy.deepcopy(data)
        data.pop('_config_version', None)  # Canonical save stamps the schema version.
        for section in (data['whatsapp'], data['platforms']['whatsapp'],
                        data['gateway']['platforms']['whatsapp'], data['gateway']['whatsapp']):
            for key in keys:
                section.pop(key, None)
                section['extra'].pop(key, None)
        return data
    assert without_edited(saved) == without_edited(cfg)
    assert (home / '.env').read_text() == ''.join(line + '\n' for key, line in env.items() if key != field)
    settings = asyncio.run(ws.get_desktop_whatsapp())['settings']
    assert settings[field] == value
    runtime = load_gateway_config().platforms[Platform.WHATSAPP]
    actual = {'enabled': runtime.enabled, 'dm_policy': runtime.extra['dm_policy'],
              'allowed_users': ','.join(runtime.extra['allow_from']), 'mode': runtime.extra['mode']}
    assert actual[field] == value


def test_whatsapp_settings_roundtrip_preserves_session_and_policy(_isolate_hermes_home):
    from hermes_cli import web_server as ws
    from hermes_constants import get_hermes_home
    home = get_hermes_home()
    session = home / 'whatsapp/session'
    session.mkdir(parents=True)
    creds = session / 'creds.json'
    creds.write_text('{"me":{"id":"15551234567:1@s.whatsapp.net","name":"Test"},"noiseKey":"SECRET"}')
    (home / 'config.yaml').write_text('whatsapp:\n  dm_policy: disabled\n')
    assert hasattr(ws, 'get_desktop_whatsapp'), 'Desktop needs a safe read-only bridge/settings endpoint'
    result = asyncio.run(ws.update_desktop_whatsapp(ws.DesktopWhatsAppUpdate(mode='bot', dm_policy='allowlist', allowed_users='15551234567', enabled=False)))
    assert result['ok']
    cfg = yaml.safe_load((home / 'config.yaml').read_text())
    assert cfg['platforms']['whatsapp']['extra']['dm_policy'] == 'allowlist'
    assert cfg['platforms']['whatsapp']['extra']['mode'] == 'bot'
    assert cfg['platforms']['whatsapp']['enabled'] is False
    assert 'SECRET' in creds.read_text()
    status = asyncio.run(ws.get_desktop_whatsapp())
    assert status['settings']['dm_policy'] == 'allowlist'
    assert status['account_name'] == 'Test'
    assert status['paired'] is True
    assert 'SECRET' not in str(status)
    assert not (home / '.env').exists() or 'WHATSAPP_' not in (home / '.env').read_text()
    from gateway.config import load_gateway_config, Platform
    from plugins.platforms.whatsapp.adapter import WhatsAppAdapter
    adapter = WhatsAppAdapter(load_gateway_config().platforms[Platform.WHATSAPP])
    assert adapter._resolved_bridge_settings() == {'WHATSAPP_MODE': 'bot', 'WHATSAPP_DM_POLICY': 'allowlist', 'WHATSAPP_ALLOWED_USERS': '15551234567', 'WHATSAPP_ALLOW_FROM': '15551234567'}


@pytest.mark.parametrize('command', [
    'node bridge.js --session /tmp/session-other --port 3000',
    'node bridge.js --session /tmp/session --port 30001',
])
def test_bridge_health_does_not_borrow_another_session(monkeypatch, tmp_path, command):
    from hermes_cli.desktop_whatsapp import _bridge_health
    from gateway import status
    session = tmp_path / 'session'
    session.mkdir()
    (session / 'bridge.pid').write_text('123\n')
    monkeypatch.setattr(status, '_read_process_cmdline', lambda pid: command.replace('/tmp/session', str(session)))
    assert _bridge_health(session, 3000)['state'] == 'unverified'


def test_qr_image_stays_local_and_disappears_on_connection():
    from hermes_cli import web_server as ws
    record = ws._WhatsAppOnboardingSession(proc=None, mode='bot', allowed_users='', session_path='/unused', expires_at='', expires_at_ts=0, status='qr', qr_payload='pairing-code')
    assert ws._whatsapp_onboarding_payload('id', record).get('qr_image', '').startswith('data:image/svg+xml;base64,')
    record.status = 'connected'
    assert ws._whatsapp_onboarding_payload('id', record).get('qr_image') is None


def test_http_mode_only_save_keeps_legacy_allowlist_and_credentials(_isolate_hermes_home):
    from hermes_cli import web_server as ws
    from hermes_constants import get_hermes_home
    from starlette.testclient import TestClient
    home = get_hermes_home()
    (home / 'config.yaml').write_text('{}\n')
    original = 'WHATSAPP_ENABLED=true\nWHATSAPP_MODE=bot\nWHATSAPP_DM_POLICY=allowlist\nWHATSAPP_ALLOWED_USERS=1555,alias@lid\n'
    (home / '.env').write_text(original)
    client = TestClient(ws.app)
    client.headers[ws._SESSION_HEADER_NAME] = ws._SESSION_TOKEN
    before = client.get('/api/messaging/whatsapp/manage').json()
    assert before['settings']['allowed_users'] == '1555,alias@lid'
    assert client.put('/api/messaging/whatsapp/manage', json={'mode': 'self-chat'}).status_code == 200
    after = client.get('/api/messaging/whatsapp/manage').json()
    assert after['settings'] == {**before['settings'], 'mode': 'self-chat'}
    assert (home / '.env').read_text() == original.replace('WHATSAPP_MODE=bot\n', '')
    assert client.put('/api/messaging/whatsapp/manage', json={'dm_policy': 'invalid'}).status_code == 422
    assert not ws._whatsapp_session_path().exists()


def test_bridge_health_reads_only_safe_values_from_real_http_server(monkeypatch, tmp_path):
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from gateway import status
    from hermes_cli.desktop_whatsapp import _bridge_health
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            assert self.path == '/health'
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'connected', 'queueLength': 0, 'sendReadReceipts': False, 'secret': 'NEVER_RETURN'}).encode())
        def log_message(self, *args): pass
    server = HTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    session = tmp_path / 'session'
    session.mkdir()
    (session / 'bridge.pid').write_text('123\n')
    port = server.server_port
    monkeypatch.setattr(status, '_read_process_cmdline', lambda pid: f'node /bridge.js --session {session} --port {port}')
    try:
        result = _bridge_health(session, port)
        assert result == {'state': 'connected', 'pid': 123, 'port': port, 'queue_length': 0, 'send_read_receipts': False}
        assert 'NEVER_RETURN' not in str(result)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_bridge_health_rejects_recycled_pid(monkeypatch, tmp_path):
    from gateway import status
    from hermes_cli.desktop_whatsapp import _bridge_health
    (tmp_path / 'bridge.pid').write_text('123\nold-start')
    monkeypatch.setattr(status, 'get_process_start_time', lambda pid: 'new-start')
    monkeypatch.setattr(status, '_read_process_cmdline', lambda pid: f'node /bridge.js --session {tmp_path} --port 1')
    assert _bridge_health(tmp_path, 1)['state'] == 'unverified'

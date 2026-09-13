import asyncio
import time
import pytest


@pytest.mark.parametrize('body_profile,expected', [(None, 'work'), ('other', 'other')])
@pytest.mark.parametrize('paired', [True, False])
def test_start_onboarding_honors_query_profile_without_touching_primary(monkeypatch, tmp_path, body_profile, expected, paired):
    import json
    from hermes_cli import web_server as ws, profiles
    from hermes_constants import get_hermes_home
    from starlette.testclient import TestClient
    home = get_hermes_home()
    monkeypatch.setattr(profiles, '_get_profiles_root', lambda: home / 'profiles')
    monkeypatch.setattr(profiles, '_get_default_hermes_home', lambda: home)
    monkeypatch.setattr(ws, '_whatsapp_onboarding_sessions', {})
    launched = []
    # Record the worker's arguments instead of starting any pairing process.
    monkeypatch.setattr(ws, '_run_whatsapp_pairing', lambda *args: launched.append(args))
    for name, directory in [('primary', home), ('work', home / 'profiles/work'), ('other', home / 'profiles/other')]:
        directory.mkdir(parents=True, exist_ok=True)
        (directory / 'config.yaml').write_text('{}\n')
        if paired or name == 'primary':
            session = directory / 'platforms/whatsapp/session'
            session.mkdir(parents=True)
            (session / 'creds.json').write_text(json.dumps({'me': {'id': '1555@s.whatsapp.net', 'name': name}}))
    original = {p: p.read_bytes() for p in home.rglob('*') if p.is_file()}
    client = TestClient(ws.app)
    client.headers[ws._SESSION_HEADER_NAME] = ws._SESSION_TOKEN
    body = {'mode': 'bot'}
    if body_profile:
        body['profile'] = body_profile
    response = client.post('/api/messaging/whatsapp/onboarding/start?profile=work', json=body)
    assert response.status_code == 200
    result = response.json()
    record = ws._whatsapp_onboarding_sessions[result['pairing_id']]
    assert record.profile == expected
    assert record.session_path == str(home / 'profiles' / expected / 'platforms/whatsapp/session')
    if paired:
        assert result['account_name'] == expected
        assert not launched
    else:
        # A fake worker may still be scheduled when the response arrives.
        for _ in range(100):
            if launched:
                break
            time.sleep(0.001)
        assert launched == [(result['pairing_id'], home / 'profiles' / expected / 'platforms/whatsapp/session', 'bot')]
    assert {p: p.read_bytes() for p in home.rglob('*') if p.is_file()} == original
    assert get_hermes_home() == home


class _FakeProc:
    def __init__(self, lines=None, returncode=0):
        self.stdout = iter(lines or [])
        self._returncode = returncode
        self.terminated = False
        self.killed = False
        self.pid = 12345

    def poll(self):
        return None if not self.terminated and not self.killed else self._returncode

    def wait(self, timeout=None):
        return self._returncode

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.killed = True








def test_apply_whatsapp_onboarding_saves_pairing_policy(monkeypatch):
    from hermes_cli import web_server as ws

    saved = {}
    removed = []
    enabled = []

    monkeypatch.setattr(ws, "save_env_value", lambda key, value: saved.setdefault(key, value))
    monkeypatch.setattr(ws, "remove_env_value", lambda key: removed.append(key))
    monkeypatch.setattr(ws, "_write_platform_enabled", lambda platform, value: enabled.append((platform, value)))
    monkeypatch.setattr(
        ws,
        "_restart_gateway_after_whatsapp_onboarding",
        lambda profile=None: {"restart_started": True, "restart_pid": 12345},
    )

    record = ws._WhatsAppOnboardingSession(
        proc=None,
        mode="bot",
        allowed_users="",
        session_path="/tmp/session",
        expires_at="2099-01-01T00:00:00Z",
        expires_at_ts=time.time() + 600,
        status="connected",
    )
    ws._whatsapp_onboarding_sessions.clear()
    ws._whatsapp_onboarding_sessions["pairing"] = record

    result = asyncio.run(
        ws.apply_whatsapp_onboarding(
            "pairing",
            ws.WhatsAppOnboardingApply(mode="bot", allowed_users=""),
        )
    )

    assert result["ok"] is True
    assert saved["WHATSAPP_MODE"] == "bot"
    assert saved["WHATSAPP_DM_POLICY"] == "pairing"
    assert saved["WHATSAPP_ENABLED"] == "true"
    assert "WHATSAPP_ALLOWED_USERS" not in removed
    assert enabled == [("whatsapp", True)]
    assert "pairing" not in ws._whatsapp_onboarding_sessions


def test_start_whatsapp_onboarding_existing_creds_returns_linked_account(monkeypatch, tmp_path):
    from hermes_cli import web_server as ws

    session_dir = tmp_path / "session"
    session_dir.mkdir()
    (session_dir / "creds.json").write_text(
        '{"me":{"id":"15551234567:1@s.whatsapp.net","name":"Hermes Bot"}}',
        encoding="utf-8",
    )

    old_proc = _FakeProc(returncode=1)
    old_record = ws._WhatsAppOnboardingSession(
        proc=old_proc,
        mode="bot",
        allowed_users="",
        session_path=str(session_dir),
        expires_at="2099-01-01T00:00:00Z",
        expires_at_ts=time.time() + 600,
    )
    ws._whatsapp_onboarding_sessions.clear()
    ws._whatsapp_onboarding_sessions["old"] = old_record
    monkeypatch.setattr(ws, "_whatsapp_session_path", lambda: session_dir)
    monkeypatch.setattr(ws.secrets, "token_urlsafe", lambda size: "existing-creds")

    result = asyncio.run(
        ws.start_whatsapp_onboarding(
            ws.WhatsAppOnboardingStart(mode="self-chat", allowed_users="")
        )
    )

    assert result["pairing_id"] == "existing-creds"
    assert result["status"] == "connected"
    assert result["qr_payload"] is None
    assert result["account_id"] == "15551234567:1@s.whatsapp.net"
    assert result["account_name"] == "Hermes Bot"
    assert result["account_phone"] == "15551234567"
    assert old_record.status == "cancelled"
    assert old_proc.terminated is True
    assert ws._whatsapp_onboarding_sessions["existing-creds"].account_phone == "15551234567"
    ws._whatsapp_onboarding_sessions.clear()





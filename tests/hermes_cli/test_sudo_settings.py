"""Sudo settings use synthetic profile fixtures, never operator credentials."""
import os

from starlette.testclient import TestClient


def client():
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    return TestClient(app, headers={_SESSION_HEADER_NAME: _SESSION_TOKEN})


def test_password_save_replace_remove_is_disk_only(_isolate_hermes_home, monkeypatch):
    from hermes_cli.config import load_env
    monkeypatch.setenv('SUDO_PASSWORD', 'process-other-profile')
    c = client()
    for secret in ['synthetic-first', ' synthetic-雪-$last ']:
        response = c.put('/api/settings/sudo/password', json={'password': secret})
        assert response.status_code == 200
        assert secret not in response.text
        assert load_env()['SUDO_PASSWORD'] == secret
        assert os.environ['SUDO_PASSWORD'] == 'process-other-profile'
        status = c.get('/api/settings/sudo').json()
        assert status['password_set'] is True
        assert secret not in str(status)
    assert c.delete('/api/settings/sudo/password').status_code == 200
    assert 'SUDO_PASSWORD' not in load_env()
    assert os.environ['SUDO_PASSWORD'] == 'process-other-profile'
    assert c.get('/api/settings/sudo').json()['password_set'] is False


def test_file_references_roundtrip_legacy_json_without_reading_contents(_isolate_hermes_home, tmp_path, monkeypatch):
    import json
    from pathlib import Path
    from hermes_cli.config import load_config, save_config
    secret_file = tmp_path / 'sudo-file'
    secret_file.write_text('never-read-this-synthetic-secret')
    cfg = load_config()
    cfg.setdefault('terminal', {})['sudo_password_files'] = json.dumps({'hp': str(secret_file)})
    save_config(cfg)
    original_read = Path.read_text
    def guarded_read(path, *a, **kw):
        assert path != secret_file, 'Settings must not read password-file contents'
        return original_read(path, *a, **kw)
    monkeypatch.setattr(Path, 'read_text', guarded_read)
    c = client()
    data = c.get('/api/settings/sudo').json()
    assert data['files'] == {'hp': str(secret_file)}
    assert data['availability']['hp'] == 'available'
    response = c.put('/api/settings/sudo/files', json={
        'file': str(secret_file), 'files': {'hp': str(secret_file), '192.168.68.57': str(secret_file), 'higole': str(tmp_path / 'missing')}
    })
    assert response.status_code == 200
    assert response.json()['availability']['higole'] == 'missing'
    assert load_config()['terminal']['sudo_password_files'] == response.json()['files']
    assert c.put('/api/settings/sudo/files', json={'file': '', 'files': {}}).status_code == 200
    assert c.get('/api/settings/sudo').json()['files'] == {}


def test_generic_env_endpoints_cannot_reveal_sudo_and_use_live_disk(_isolate_hermes_home):
    from tools.terminal_tool import _configured_sudo_password_for_command
    c = client()
    secret = 'synthetic-sudo-do-not-return-suffix'
    assert c.put('/api/env', json={'key': 'SUDO_PASSWORD', 'value': secret}).status_code == 200
    row = c.get('/api/env').json()['SUDO_PASSWORD']
    assert row['redacted_value'] in (None, '••••••••')
    assert c.post('/api/env/reveal', json={'key': 'SUDO_PASSWORD'}).status_code == 403
    assert _configured_sudo_password_for_command('sudo id') == (True, secret)
    assert c.request('DELETE', '/api/env', json={'key': 'SUDO_PASSWORD'}).status_code == 200
    assert _configured_sudo_password_for_command('sudo id') == (False, None)


def test_password_validation_never_echoes_input(_isolate_hermes_home):
    c = client()
    for value in [[], {'password': {'secret': 'do-not-echo'}}, {'password': 'do-not-echo\n'}, {'secret': 'do-not-echo'}]:
        response = c.put('/api/settings/sudo/password', json=value)
        assert response.status_code == 400
        assert 'do-not-echo' not in response.text


def test_write_only_dedicated_files_require_explicit_overwrite(_isolate_hermes_home):
    from pathlib import Path
    c = client()
    request = {'host': 'hp', 'password': 'synthetic-file-first', 'overwrite': False}
    response = c.put('/api/settings/sudo/file-password', json=request)
    assert response.status_code == 200
    path = Path(response.json()['files']['hp'])
    assert path.read_text() == 'synthetic-file-first'
    assert path.stat().st_mode & 0o777 == 0o600
    assert 'synthetic-file-first' not in response.text
    request['password'] = 'synthetic-file-second'
    assert c.put('/api/settings/sudo/file-password', json=request).status_code == 409
    assert path.read_text() == 'synthetic-file-first'
    request['overwrite'] = True
    assert c.put('/api/settings/sudo/file-password', json=request).status_code == 200
    assert path.read_text() == 'synthetic-file-second'
    path.unlink()
    target = path.parent / 'other'
    target.write_text('do-not-touch')
    path.symlink_to(target)
    assert c.put('/api/settings/sudo/file-password', json=request).status_code == 400
    assert target.read_text() == 'do-not-touch'
    request['host'] = '../outside'
    assert c.put('/api/settings/sudo/file-password', json=request).status_code == 400


def test_password_replacement_removes_duplicate_entries_and_secures_env(_isolate_hermes_home):
    from hermes_constants import get_hermes_home
    from hermes_cli.config import load_env
    home = get_hermes_home()
    home.mkdir(parents=True, exist_ok=True)
    env = home / '.env'
    env.write_text('SUDO_PASSWORD=old-first\nexport SUDO_PASSWORD=old-last\nOTHER_KEY=keep\n')
    env.chmod(0o644)
    response = client().put('/api/settings/sudo/password', json={'password': 'new-synthetic'})
    assert response.status_code == 200
    assert load_env()['SUDO_PASSWORD'] == 'new-synthetic'
    assert env.stat().st_mode & 0o777 == 0o600
    assert load_env()['OTHER_KEY'] == 'keep'


def test_managed_terminal_settings_refuse_mutations(_isolate_hermes_home, monkeypatch):
    from hermes_cli import managed_scope
    monkeypatch.setattr(managed_scope, 'is_key_managed', lambda key: key.startswith('terminal.'))
    c = client()
    assert c.put('/api/settings/sudo/files', json={'file': '', 'files': {}}).status_code == 403
    assert c.put('/api/settings/sudo/password', json={'password': 'synthetic'}).status_code == 403
    assert c.put('/api/settings/sudo/file-password', json={'host': 'hp', 'password': 'synthetic'}).status_code == 403

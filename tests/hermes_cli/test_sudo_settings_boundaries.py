"""HTTP and profile boundaries for write-only sudo settings."""
from starlette.testclient import TestClient


def _client():
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    return TestClient(app, headers={_SESSION_HEADER_NAME: _SESSION_TOKEN})


def test_sudo_password_targets_selected_profile_only(tmp_path, monkeypatch):
    from hermes_cli import profiles
    from hermes_constants import get_hermes_home
    from dotenv import dotenv_values

    root = tmp_path / 'profiles'
    monkeypatch.setattr(profiles, '_get_profiles_root', lambda: root)
    for name in ('machine-a', 'machine-b'):
        home = root / name
        home.mkdir(parents=True)
        (home / 'config.yaml').write_text('{}\n')
    c = _client()
    for name in ('machine-a', 'machine-b'):
        response = c.put('/api/settings/sudo/password', params={'profile': name},
                         json={'password': f'synthetic-{name}'})
        assert response.status_code == 200, response.text
        assert response.json()['owner']['home'] == str(root / name)
    for name in ('machine-a', 'machine-b'):
        assert dotenv_values(root / name / '.env')['SUDO_PASSWORD'] == f'synthetic-{name}'
    assert 'SUDO_PASSWORD' not in dotenv_values(get_hermes_home() / '.env')
    assert c.delete('/api/settings/sudo/password', params={'profile': 'machine-a'}).status_code == 200
    assert 'SUDO_PASSWORD' not in dotenv_values(root / 'machine-a' / '.env')
    assert dotenv_values(root / 'machine-b' / '.env')['SUDO_PASSWORD'] == 'synthetic-machine-b'


def test_sudo_password_validation_never_echoes_submitted_values():
    c = _client()
    marker = 'synthetic-sensitive-invalid-value'
    for body in ([marker], marker, {'unexpected': marker}):
        response = c.put('/api/settings/sudo/password', json=body)
        assert response.status_code in (400, 422), response.text
        assert marker not in response.text
    for value in ([marker], {'nested': marker}, marker + '\nsecond-line', marker + '\0'):
        response = c.put('/api/settings/sudo/password', json={'password': value})
        assert response.status_code in (400, 422), response.text
        assert marker not in response.text


def test_sudo_settings_require_authentication():
    from hermes_cli.web_server import app
    c = TestClient(app)
    for method, path, body in (
        ('get', '/api/settings/sudo', None),
        ('put', '/api/settings/sudo/password', {'password': 'synthetic-only'}),
        ('delete', '/api/settings/sudo/password', None),
        ('put', '/api/settings/sudo/files', {'file': '', 'files': {}}),
    ):
        kwargs = {'json': body} if body is not None else {}
        response = getattr(c, method)(path, **kwargs)
        assert response.status_code in (401, 403)

"""Real disk/API → resolver → subprocess stdin, using synthetic credentials only."""
import shlex
import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient


def _exercise_inspector_execution(tmp_path):
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from tools.environments.local import LocalEnvironment
    from tools.terminal_tool import _configured_sudo_password_for_command

    client = TestClient(app, headers={_SESSION_HEADER_NAME: _SESSION_TOKEN})
    # Never elevate: this executable only validates the injected synthetic stdin,
    # then runs an unprivileged script. No mocks in the storage/execution chain.
    fake_sudo = tmp_path / 'sudo'
    fake_sudo.write_text(
        f'#!{sys.executable}\n'
        'import os, sys\n'
        'received = bytearray()\n'
        'while True:\n'
        '    char = os.read(0, 1)\n'
        '    if char in (b"", b"\\n"): break\n'
        '    received.extend(char)\n'
        'if received.decode() not in ("synthetic-direct", "synthetic-external"): sys.exit(9)\n'
        'assert sys.argv[1:4] == ["-S", "-p", ""]\n'
        'os.execvp(sys.argv[4], sys.argv[4:])\n'
    )
    fake_sudo.chmod(0o700)
    script = tmp_path / 'job.py'
    script.write_text('print("script-ran-with-injected-stdin")\n')
    command = f'PATH={shlex.quote(str(tmp_path))}:$PATH sudo {shlex.quote(sys.executable)} {shlex.quote(str(script))}'
    env = LocalEnvironment(cwd=str(tmp_path), timeout=15)
    try:
        saved = client.put('/api/settings/sudo/file-password', json={
            'host': 'local', 'password': 'synthetic-direct', 'overwrite': False,
        })
        assert saved.status_code == 200
        assert 'synthetic-direct' not in saved.text
        managed = Path(saved.json()['files']['local'])
        assert managed.stat().st_mode & 0o777 == 0o600
        assert managed.parent.stat().st_mode & 0o777 == 0o700
        result = env.execute(command)
        assert result['returncode'] == 0, result
        assert 'script-ran-with-injected-stdin' in result['output']
        assert 'synthetic-direct' not in result['output']

        external = tmp_path / 'external.password'
        external.write_text('synthetic-external\n')
        external.chmod(0o600)
        saved = client.put('/api/settings/sudo/files', json={
            'file': '', 'files': {'local': str(external), 'test-ssh-host': str(managed)},
        })
        assert saved.status_code == 200
        # Same already-running environment must observe new references immediately.
        result = env.execute(command)
        assert result['returncode'] == 0, result
        assert 'script-ran-with-injected-stdin' in result['output']
        assert 'synthetic-external' not in result['output']
        assert _configured_sudo_password_for_command('ssh test-ssh-host sudo id') == (True, 'synthetic-direct')
        assert _configured_sudo_password_for_command('ssh unmatched-host sudo id') == (False, None)
        status = client.get('/api/settings/sudo').text
        assert 'synthetic-direct' not in status and 'synthetic-external' not in status
    finally:
        env.cleanup()


@pytest.mark.macos_only
def test_inspector_storage_to_process_stdin_macos(tmp_path):
    _exercise_inspector_execution(tmp_path)


@pytest.mark.linux_only
def test_inspector_storage_to_process_stdin_linux(tmp_path):
    _exercise_inspector_execution(tmp_path)

"""Real settings → terminal resolution with synthetic profile homes."""
import pytest


def test_settings_are_live_and_profile_scoped(_isolate_hermes_home, tmp_path, monkeypatch):
    from hermes_cli.sudo_settings import set_password, set_files
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    from tools.terminal_tool import _configured_sudo_password_for_command as resolve
    monkeypatch.setenv('SUDO_PASSWORD', 'other-profile-startup')
    monkeypatch.setenv('SUDO_PASSWORD_FILE', '')
    monkeypatch.setenv('SUDO_PASSWORD_FILES', '{}')
    monkeypatch.setenv('TERMINAL_ENV', 'local')
    set_password('first')
    assert resolve('sudo whoami') == (True, 'first')
    set_password('second')
    assert resolve('sudo whoami') == (True, 'second')
    f = tmp_path / 'hp-password'
    f.write_text('hp-synthetic\n')
    set_files('', {'hp': str(f), '192.168.68.57': str(f)})
    assert resolve("ssh user@hp 'sudo whoami'") == (True, 'hp-synthetic')
    assert resolve("ssh user@192.168.68.57 'sudo whoami'") == (True, 'hp-synthetic')
    assert resolve("ssh unknown 'sudo whoami'") == (False, None)
    set_password(None)
    assert resolve('sudo whoami') == (False, None)
    token = set_hermes_home_override(str(tmp_path / 'profile-b'))
    try:
        set_password('profile-b')
        assert resolve('sudo whoami') == (True, 'profile-b')
    finally:
        reset_hermes_home_override(token)
    assert resolve('sudo whoami') == (False, None)


def test_unscoped_multiplexer_never_uses_process_sudo_secret(monkeypatch):
    from agent.secret_scope import set_multiplex_active
    from tools.terminal_tool import _scoped_secret_or_env
    monkeypatch.setenv('SUDO_PASSWORD', 'other-profile')
    set_multiplex_active(True)
    try:
        assert _scoped_secret_or_env('SUDO_PASSWORD') is None
    finally:
        set_multiplex_active(False)


def test_ssh_backend_does_not_fall_back_to_local_password(_isolate_hermes_home, tmp_path, monkeypatch):
    from hermes_cli.config import load_config, save_config
    from hermes_cli.sudo_settings import set_password, set_files
    from tools.terminal_tool import _configured_sudo_password_for_command as resolve
    monkeypatch.setenv('TERMINAL_ENV', 'local')  # stale process bridge is not authoritative
    f = tmp_path / 'local-secret'
    f.write_text('synthetic-local')
    set_password('synthetic-env')
    set_files(str(f), {'local': str(f), 'default': str(f)})
    config = load_config()
    config['terminal'].update({'backend': 'ssh', 'ssh_host': '192.168.68.57'})
    save_config(config)
    assert resolve('sudo id') == (False, None)
    set_files(str(f), {'192.168.68.57': str(f)})
    assert resolve('sudo id') == (True, 'synthetic-local')


def test_unmatched_ssh_never_reuses_local_interactive_cache(_isolate_hermes_home, monkeypatch):
    from hermes_cli.sudo_settings import set_files
    from tools import terminal_tool as terminal
    set_files('', {})
    monkeypatch.setenv('HERMES_INTERACTIVE', '0')
    monkeypatch.setattr(terminal, '_get_sudo_password_callback', lambda: None)
    terminal._set_cached_sudo_password('local-cached-synthetic')
    try:
        command = "ssh unknown 'sudo id'"
        assert terminal._transform_sudo_command(command) == (command, None)
    finally:
        terminal._reset_cached_sudo_passwords()


def test_interactive_local_hp_higole_credentials_stay_separate(_isolate_hermes_home, monkeypatch):
    from hermes_cli.sudo_settings import set_files
    from tools import terminal_tool as terminal
    set_files('', {})
    answers = iter(['local-answer', 'hp-answer', 'higole-answer'])
    terminal.set_sudo_password_callback(lambda: next(answers))
    monkeypatch.setattr(terminal, '_sudo_nopasswd_works', lambda: False)
    try:
        assert terminal._transform_sudo_command('sudo id')[1] == 'local-answer\n'
        # A local NOPASSWD result must never suppress a remote prompt.
        monkeypatch.setattr(terminal, '_sudo_nopasswd_works', lambda: True)
        assert terminal._transform_sudo_command("ssh hp 'sudo id'")[1] == 'hp-answer\n'
        assert terminal._transform_sudo_command("ssh higole 'sudo id'")[1] == 'higole-answer\n'
        assert terminal._transform_sudo_command('sudo id')[1] == 'local-answer\n'
    finally:
        terminal.set_sudo_password_callback(None)
        terminal._reset_cached_sudo_passwords()

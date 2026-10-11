"""PWA setup uses the profile config, never an environment setting."""
from hermes_cli import setup
from types import SimpleNamespace
import argparse


def test_setup_saves_normalized_origin_and_preserves_listener(monkeypatch):
    monkeypatch.setattr(setup, 'is_interactive_stdin', lambda: True)
    monkeypatch.setattr(setup, 'prompt', lambda *_args, **_kwargs: 'https://browser.example.net/')
    config = {'desktop': {'browser_proxy_bind': '192.168.196.177', 'browser_proxy_port': 9121}}
    setup.setup_browser_proxy(config)
    assert config['desktop'] == {
        'browser_proxy_origin': 'https://browser.example.net',
        'browser_proxy_setup_complete': True,
        'browser_proxy_bind': '192.168.196.177',
        'browser_proxy_port': 9121,
    }


def test_browser_section_is_available_from_cli():
    from hermes_cli.subcommands.setup import build_setup_parser
    parser = argparse.ArgumentParser()
    build_setup_parser(parser.add_subparsers(), cmd_setup=lambda _: None)
    assert parser.parse_args(['setup', 'browser']).section == 'browser'


def test_first_time_quick_setup_persists_proxy_choice(monkeypatch):
    from hermes_cli.config import load_config, get_hermes_home
    import hermes_cli.main
    import hermes_cli.gateway
    monkeypatch.setattr(setup, 'is_interactive_stdin', lambda: True)
    monkeypatch.setattr(hermes_cli.main, '_model_flow_nous', lambda _: None)
    monkeypatch.setattr(hermes_cli.gateway, 'ensure_gateway_service', lambda **_: None)
    monkeypatch.setattr(setup, 'setup_terminal_backend', lambda _: None)
    monkeypatch.setattr(setup, '_apply_default_agent_settings', lambda _: None)
    monkeypatch.setattr(setup, '_print_setup_summary', lambda *_: None)
    monkeypatch.setattr(setup, 'prompt_choice', lambda *_: 1)
    monkeypatch.setattr(setup, 'prompt', lambda *_args, **_kwargs: 'https://browser.example.net/')
    config = load_config()
    setup._run_first_time_quick_setup(config, get_hermes_home(), False)
    assert load_config()['desktop']['browser_proxy_origin'] == 'https://browser.example.net'


def test_full_setup_persists_proxy_choice(monkeypatch):
    from hermes_cli.config import load_config
    import hermes_cli.auth
    monkeypatch.setattr(setup, 'is_interactive_stdin', lambda: True)
    monkeypatch.setattr(hermes_cli.auth, 'get_active_provider', lambda: None)
    monkeypatch.setattr(setup, 'get_env_value', lambda *_: None)
    monkeypatch.setattr(setup, '_offer_openclaw_migration', lambda *_: False)
    for name in ['setup_model_provider', 'setup_terminal_backend', 'setup_gateway', 'setup_tools', '_apply_default_agent_settings', '_print_setup_summary']:
        monkeypatch.setattr(setup, name, lambda *_args, **_kwargs: None)
    monkeypatch.setattr(setup, 'prompt_choice', lambda *_: 1)
    monkeypatch.setattr(setup, 'prompt', lambda *_args, **_kwargs: 'https://browser.example.net/')
    setup.run_setup_wizard(SimpleNamespace())
    assert load_config()['desktop']['browser_proxy_origin'] == 'https://browser.example.net'


def test_blank_slate_does_not_enable_or_prompt_for_optional_proxy():
    config = {'desktop': {'browser_proxy_origin': 'https://browser.example.net'}}
    setup._blank_slate_minimize_config(config)
    assert config['desktop']['browser_proxy_origin'] == ''
    assert config['desktop']['browser_proxy_setup_complete'] is True


def test_headless_setup_leaves_existing_choice_untouched(monkeypatch):
    monkeypatch.setattr(setup, 'is_interactive_stdin', lambda: False)
    config = {'desktop': {'browser_proxy_origin': 'https://browser.example.net'}}
    setup.setup_browser_proxy(config)
    assert config == {'desktop': {'browser_proxy_origin': 'https://browser.example.net'}}


def test_invalid_origin_retries_before_saving(monkeypatch):
    monkeypatch.setattr(setup, 'is_interactive_stdin', lambda: True)
    values = iter(['http://bad.example.net', 'https://browser.example.net'])
    monkeypatch.setattr(setup, 'prompt', lambda *_args, **_kwargs: next(values))
    config = {}
    setup.setup_browser_proxy(config)
    assert config['desktop']['browser_proxy_origin'] == 'https://browser.example.net'


def test_deferring_setup_is_remembered(monkeypatch):
    monkeypatch.setattr(setup, 'is_interactive_stdin', lambda: True)
    monkeypatch.setattr(setup, 'prompt', lambda *_args, **_kwargs: '')
    config = {}
    setup.setup_browser_proxy(config)
    assert config['desktop'] == {'browser_proxy_origin': '', 'browser_proxy_setup_complete': True}

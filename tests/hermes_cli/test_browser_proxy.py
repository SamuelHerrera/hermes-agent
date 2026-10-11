import pytest


def test_proxy_requires_distinct_https_origin():
    from hermes_cli.browser_proxy import validate_origins
    assert validate_origins('https://proxy.example.net', 'https://hermes.example.org') == 'https://proxy.example.net'
    for proxy in ['https://hermes.example.org', 'https://hermes.example.org:9443', 'http://proxy.example.net', 'https://u:p@proxy.example.net', 'https://proxy.example.net/path', 'https://proxy.example.net?x=1']:
        with pytest.raises(ValueError):
            validate_origins(proxy, 'https://hermes.example.org')


def test_proxy_bind_cannot_expose_all_interfaces():
    from hermes_cli.browser_proxy import validate_bind
    assert validate_bind('127.0.0.1') == '127.0.0.1'
    assert validate_bind('192.168.196.177') == '192.168.196.177'
    for value in ['0.0.0.0', '::', 'example.com', '8.8.8.8', '169.254.1.1', '203.0.113.1', '100.64.1.1']:
        with pytest.raises(ValueError):
            validate_bind(value)


def test_optional_node_missing_does_not_break_backend_startup(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    import hermes_constants
    from hermes_cli import browser_proxy
    monkeypatch.setattr(hermes_constants, 'find_node_executable', lambda *_: None)
    desktop = {'browser_proxy_origin': 'https://browser.example.net'}
    monkeypatch.setattr(browser_proxy, 'desktop_proxy_config', lambda: desktop)
    app = SimpleNamespace(state=SimpleNamespace())
    asyncio.run(browser_proxy.recover_proxy(app))
    assert app.state.browser_proxy_origin == 'https://browser.example.net'
    assert app.state.browser_proxy.process is None
    with pytest.raises(RuntimeError, match='npm ci'):
        asyncio.run(app.state.browser_proxy.bootstrap(desktop, 'https://hermes.example.org'))

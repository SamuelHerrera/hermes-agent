import json
import subprocess
from types import SimpleNamespace

import pytest

from hermes_cli import browser_proxy


@pytest.fixture
def proxy_package(tmp_path, monkeypatch):
    import hermes_constants
    (tmp_path / 'package.json').write_text(json.dumps({'dependencies': {'fixture-proxy': '1.0.0'}}))
    (tmp_path / 'package-lock.json').write_text('{}')
    monkeypatch.setattr(hermes_constants, 'find_node_executable', lambda name: '/test/npm')
    return tmp_path


def test_install_is_locked_script_free_and_reuses_verified_dependencies(proxy_package, monkeypatch):
    calls = []
    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        module = proxy_package / 'node_modules' / 'fixture-proxy'
        module.mkdir(parents=True, exist_ok=True)
        (module / 'package.json').write_text('{"version":"1.0.0"}')
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(subprocess, 'run', run)
    assert browser_proxy.install_dependencies(proxy_package) is True
    assert browser_proxy.install_dependencies(proxy_package) is False
    assert len(calls) == 1
    argv, kwargs = calls[0]
    assert argv == ['/test/npm', 'ci', '--ignore-scripts', '--workspaces=false', '--no-fund', '--no-audit']
    assert kwargs['cwd'] == proxy_package
    assert kwargs['timeout'] == 600
    (proxy_package / 'package-lock.json').write_text('{"updated":true}')
    assert browser_proxy.install_dependencies(proxy_package) is True
    (proxy_package / 'node_modules' / 'fixture-proxy' / 'package.json').unlink()
    assert browser_proxy.install_dependencies(proxy_package) is True


def test_install_failure_is_not_cached(proxy_package, monkeypatch):
    monkeypatch.setattr(subprocess, 'run', lambda *args, **kwargs: SimpleNamespace(returncode=1))
    with pytest.raises(RuntimeError, match='failed'):
        browser_proxy.install_dependencies(proxy_package)
    assert not (proxy_package / 'node_modules' / '.hermes-proxy-lock.sha256').exists()


def test_install_requires_npm(proxy_package, monkeypatch):
    import hermes_constants
    monkeypatch.setattr(hermes_constants, 'find_node_executable', lambda name: None)
    with pytest.raises(RuntimeError, match='npm'):
        browser_proxy.install_dependencies(proxy_package)


@pytest.mark.parametrize('failure', [False, True])
def test_update_refreshes_proxy_even_when_workspace_lock_is_unchanged(tmp_path, monkeypatch, failure):
    from hermes_cli import main, update_cmd
    import tools.browser_tool
    (tmp_path / 'package.json').write_text('{}')
    proxy_root = tmp_path / 'hermes_cli' / 'browser_proxy'
    proxy_root.mkdir(parents=True)
    (proxy_root / 'package.json').write_text('{}')
    monkeypatch.setattr(main, 'PROJECT_ROOT', tmp_path)
    monkeypatch.setattr(main, '_resolve_node_runtime_npm', lambda: '/test/npm')
    monkeypatch.setattr(main, '_npm_lockfile_changed', lambda *_: False)
    monkeypatch.setattr(tools.browser_tool, 'warm_agent_browser_npx_cache', lambda: None)
    calls = []
    def install(root):
        calls.append(root)
        if failure:
            raise RuntimeError('installation failed')
        return True
    monkeypatch.setattr(browser_proxy, 'install_dependencies', install)
    assert update_cmd._update_node_dependencies() == (['browser proxy'] if failure else [])
    assert calls == [proxy_root]

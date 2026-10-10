"""A browser-only backend must recover an installed host after a reboot."""
import asyncio
import json
import os
from pathlib import Path
import shutil
import subprocess

from fastapi import FastAPI
import pytest


@pytest.mark.macos_only
@pytest.mark.asyncio
async def test_browser_backend_starts_installed_host_without_electron(tmp_path, monkeypatch):
    from hermes_cli import web_server
    from hermes_cli.web_routers.capabilities import probe_capabilities

    node = shutil.which("node")
    if not node:
        pytest.skip("Node is required for the real terminal-host integration")
    home = tmp_path / "home"
    version = home / "terminal-host" / "versions" / "test-version"
    version.mkdir(parents=True)
    (version / "node").symlink_to(node)
    (version / "package").symlink_to(Path(__file__).parents[2] / "packages" / "terminal-host", target_is_directory=True)
    (version / "manifest.json").write_text(json.dumps({"version": "test-version", "platform": "darwin", "arch": "arm64" if os.uname().machine == "arm64" else "x64"}))
    runtime = home / "terminal-host" / "runtime"
    runtime.mkdir(mode=0o700)
    (runtime / "host.lock").mkdir()
    (runtime / "endpoint.json").write_text(json.dumps({"port": 65534, "epoch": "stale", "token": "stale"}))
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.delenv("HERMES_DESKTOP", raising=False)
    monkeypatch.setattr(web_server, "_warm_gateway_module", lambda: None)

    def cli(*args):
        return subprocess.run([node, str(version / "package/src/cli.mjs"), *args, "--dir", str(runtime)], capture_output=True, text=True, timeout=20, check=True)

    try:
        assert not probe_capabilities()["capabilities"]["persistentTerminal"]
        async with web_server._lifespan(FastAPI()):
            assert probe_capabilities()["capabilities"]["persistentTerminal"], "browser-only startup left an installed terminal host unavailable"
            status = json.loads(cli("status").stdout)
            assert status["epoch"] != "stale"
            # A second server startup must reuse the live host, not restart it.
            async with web_server._lifespan(FastAPI()):
                assert json.loads(cli("status").stdout)["epoch"] == status["epoch"]
        # Backend shutdown must not destroy the independently owned host/PTYS.
        assert json.loads(cli("status").stdout)["epoch"] == status["epoch"]
    finally:
        if (runtime / "endpoint.json").exists():
            subprocess.run([node, str(version / "package/src/cli.mjs"), "stop", "--dir", str(runtime), "--force"], capture_output=True, timeout=20)
        await asyncio.sleep(0)


@pytest.mark.parametrize("broken", ["dangling", "array-manifest", "unfinished", "failed-start"])
def test_optional_host_recovery_skips_broken_newer_candidates(tmp_path, monkeypatch, broken):
    import platform
    import sys
    from hermes_cli import terminal_host
    from hermes_cli.web_routers import capabilities

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    versions = tmp_path / "terminal-host/versions"
    versions.mkdir(parents=True)
    arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64", "AMD64": "x64"}.get(platform.machine())
    manifest = {"platform": sys.platform, "arch": arch}
    good = versions / "good"
    good.mkdir()
    node_name = "node.exe" if os.name == "nt" else "node"
    (good / node_name).touch()
    (good / "package/src").mkdir(parents=True)
    (good / "package/src/cli.mjs").touch()
    (good / "manifest.json").write_text(json.dumps(manifest))
    os.utime(good, (1, 1))
    bad = versions / (".install-in-progress" if broken == "unfinished" else "bad")
    if broken == "dangling":
        bad.symlink_to(tmp_path / "absent", target_is_directory=True)
    else:
        shutil.copytree(good, bad)
        os.utime(bad, (2, 2))
        if broken == "array-manifest":
            (bad / "manifest.json").write_text("[]")
    calls = []
    monkeypatch.setattr(capabilities, "_persistent_terminal_available", lambda: bool(calls and calls[-1] == good))

    def run(argv, **kwargs):
        candidate = Path(argv[0]).parent
        calls.append(candidate)
        if candidate == bad:
            raise subprocess.CalledProcessError(1, argv)
        return subprocess.CompletedProcess(argv, 0)

    monkeypatch.setattr(terminal_host.subprocess, "run", run)
    assert terminal_host.ensure_installed_terminal_host()
    assert calls[-1] == good
    if broken != "failed-start":
        assert calls == [good]


def test_optional_host_recovery_tolerates_unreadable_versions(tmp_path, monkeypatch):
    from hermes_cli import terminal_host
    from hermes_cli.web_routers import capabilities
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    versions = tmp_path / "terminal-host/versions"
    versions.mkdir(parents=True)
    monkeypatch.setattr(capabilities, "_persistent_terminal_available", lambda: False)
    original = Path.iterdir
    def iterdir(path):
        if path == versions:
            raise PermissionError("optional installation unreadable")
        return original(path)
    monkeypatch.setattr(Path, "iterdir", iterdir)
    assert terminal_host.ensure_installed_terminal_host() is False


@pytest.mark.asyncio
async def test_optional_host_recovery_failure_does_not_prevent_backend_startup(monkeypatch):
    from hermes_cli import web_server, terminal_host
    monkeypatch.setattr(web_server, "_warm_gateway_module", lambda: None)
    def fail():
        raise RuntimeError("optional host recovery failed")
    monkeypatch.setattr(terminal_host, "ensure_installed_terminal_host", fail)
    async with web_server._lifespan(FastAPI()):
        pass

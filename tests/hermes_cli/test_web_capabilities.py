"""Backend capability manifest contracts."""

from fastapi import FastAPI
from starlette.testclient import TestClient


def test_capability_manifest_is_versioned_and_fails_each_probe_closed(monkeypatch):
    import hermes_cli.web_routers.capabilities as capabilities

    monkeypatch.setattr(capabilities, "_files_available", lambda: True)
    monkeypatch.setattr(capabilities, "_git_available", lambda: (_ for _ in ()).throw(RuntimeError("broken")))
    monkeypatch.setattr(capabilities, "_persistent_terminal_available", lambda: True)
    monkeypatch.setattr(capabilities, "_lifecycle_available", lambda: False)

    assert capabilities.probe_capabilities() == {
        "version": 1,
        "capabilities": {
            "files": True,
            "git": False,
            "persistentTerminal": True,
            "lifecycle": False,
        },
    }


def test_capabilities_do_not_infer_availability_from_hermes_desktop(monkeypatch):
    import hermes_cli.web_routers.capabilities as capabilities

    monkeypatch.setattr(capabilities, "_files_available", lambda: False)
    monkeypatch.setattr(capabilities, "_git_available", lambda: False)
    monkeypatch.setattr(capabilities, "_persistent_terminal_available", lambda: False)
    monkeypatch.setattr(capabilities, "_lifecycle_available", lambda: False)

    monkeypatch.setenv("HERMES_DESKTOP", "1")
    with_desktop_env = capabilities.probe_capabilities()
    monkeypatch.delenv("HERMES_DESKTOP")

    assert capabilities.probe_capabilities() == with_desktop_env
    assert not any(with_desktop_env["capabilities"].values())


def test_capabilities_router_uses_dashboard_auth_middleware():
    import hermes_cli.web_server as web_server

    client = TestClient(web_server.app)
    unauthenticated = client.get("/api/capabilities")
    authenticated = client.get(
        "/api/capabilities",
        headers={web_server._SESSION_HEADER_NAME: web_server._SESSION_TOKEN},
    )

    assert unauthenticated.status_code == 401
    assert authenticated.status_code == 200
    payload = authenticated.json()
    assert payload["version"] == 1
    assert set(payload["capabilities"]) == {"files", "git", "persistentTerminal", "lifecycle"}
    assert all(isinstance(value, bool) for value in payload["capabilities"].values())


def test_capability_router_is_focused_and_mountable():
    from hermes_cli.web_routers.capabilities import router

    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).get("/api/capabilities")

    assert response.status_code == 200

from fastapi.testclient import TestClient

from hermes_cli import web_server


class FakeManager:
    kind = "systemd"

    def __init__(self):
        self.calls = []

    def restart(self, name):
        self.calls.append(("restart", name))


def _client():
    client = TestClient(web_server.app)
    client.headers[web_server._SESSION_HEADER_NAME] = web_server._SESSION_TOKEN
    return client


def test_lifecycle_status_is_read_only_and_advertises_authority(monkeypatch):
    manager = FakeManager()
    monkeypatch.setattr(web_server, "_lifecycle_service_manager", lambda: manager)
    monkeypatch.setattr(web_server, "_desktop_backend_service_installed", lambda kind: True)

    response = _client().get("/api/lifecycle")

    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 1
    assert body["authority"] == {"externally_managed": True, "kind": "systemd"}
    assert body["actions"]["gateway-restart"]["supported"] is True
    assert body["actions"]["backend-restart"]["supported"] is True
    assert body["actions"]["uninstall"]["supported"] is False
    assert manager.calls == []


def test_lifecycle_derives_production_authority_without_app_state_knobs(monkeypatch):
    manager = FakeManager()
    monkeypatch.setattr(web_server, "_lifecycle_service_manager", lambda: manager)
    monkeypatch.setattr(web_server, "_desktop_backend_service_installed", lambda kind: True)

    status = web_server._lifecycle_status()

    assert status["authority"] == {"externally_managed": True, "kind": "systemd"}
    assert status["actions"]["backend-restart"]["supported"] is True


def test_backend_restart_uses_fixed_server_authority_not_request_paths(monkeypatch):
    manager = FakeManager()
    monkeypatch.setattr(web_server, "_lifecycle_service_manager", lambda: manager)
    monkeypatch.setattr(web_server, "_desktop_backend_service_installed", lambda kind: True)

    response = _client().post(
        "/api/lifecycle/action",
        json={"action": "backend-restart", "service": "../../attacker"},
    )

    assert response.status_code == 200
    assert response.json()["relaunch"] is False
    assert manager.calls == [("restart", "ai.hermes.serve")]


def test_uninstall_is_not_advertised_without_a_production_manager_operation(monkeypatch):
    manager = FakeManager()
    monkeypatch.setattr(web_server, "_lifecycle_service_manager", lambda: manager)
    monkeypatch.setattr(web_server, "_desktop_backend_service_installed", lambda kind: True)
    client = _client()

    response = client.post(
        "/api/lifecycle/action",
        json={"action": "uninstall", "confirmation": "UNINSTALL"},
    )
    assert response.status_code == 409
    assert manager.calls == []


def test_lifecycle_fails_closed_without_external_manager(monkeypatch):
    monkeypatch.setattr(web_server, "_lifecycle_service_manager", lambda: None)
    monkeypatch.setattr(web_server, "_desktop_backend_service_installed", lambda kind: False)
    client = _client()

    status = client.get("/api/lifecycle").json()
    assert status["authority"] == {"externally_managed": False, "kind": "none"}
    assert status["actions"]["backend-restart"]["supported"] is False
    assert "hermes" in status["actions"]["backend-restart"]["guidance"]
    assert client.post("/api/lifecycle/action", json={"action": "backend-restart"}).status_code == 409


def test_lifecycle_requires_auth():
    response = TestClient(web_server.app).get("/api/lifecycle")
    assert response.status_code == 401

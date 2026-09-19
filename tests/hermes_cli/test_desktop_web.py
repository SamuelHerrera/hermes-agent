"""Authenticated browser-Desktop SPA serving contracts."""

from fastapi import FastAPI
from starlette.testclient import TestClient


def _client(tmp_path, monkeypatch, *, gated=False):
    import hermes_cli.desktop_web as desktop_web

    dist = tmp_path / "desktop_web_dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(
        '<html><head><script type="module" src="./assets/app-a1b2c3.js"></script></head><body>Desktop SPA</body></html>',
        encoding="utf-8",
    )
    (dist / "assets" / "app-a1b2c3.js").write_text("window.desktopLoaded=true", encoding="utf-8")
    monkeypatch.setattr(desktop_web, "DESKTOP_WEB_DIST", dist)

    app = FastAPI()
    app.state.auth_required = gated
    desktop_web.mount_desktop_spa(
        app,
        session_token="secret-token",
        normalise_prefix=lambda value: "/proxy" if value == "/proxy" else "",
    )
    return TestClient(app)


def test_desktop_spa_injects_loopback_auth_without_token_endpoint(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    response = client.get("/desktop/")

    assert response.status_code == 200
    assert response.headers["cache-control"].startswith("no-store")
    assert '"authRequired":false' in response.text
    assert '"basePath":""' in response.text
    assert '"sessionToken":"secret-token"' in response.text
    assert client.get("/desktop/api/session-token").status_code == 404


def test_desktop_spa_uses_cookie_auth_bootstrap_and_proxy_prefix(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch, gated=True)

    response = client.get("/desktop/session/abc", headers={"X-Forwarded-Prefix": "/proxy"})

    assert response.status_code == 200
    assert '"authRequired":true' in response.text
    assert '"basePath":"/proxy"' in response.text
    assert "sessionToken" not in response.text
    assert 'src="/proxy/desktop/assets/app-a1b2c3.js"' in response.text


def test_desktop_assets_are_immutable_and_api_misses_are_json(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    asset = client.get("/desktop/assets/app-a1b2c3.js")
    missing_api = client.get("/desktop/api/not-real")

    assert asset.status_code == 200
    assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert missing_api.status_code == 404
    assert missing_api.headers["content-type"].startswith("application/json")
    assert missing_api.json() == {"detail": "No such API endpoint: /desktop/api/not-real"}


def test_headless_serve_never_serves_desktop_bundle(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_SERVE_HEADLESS", "1")
    client = _client(tmp_path, monkeypatch)

    response = client.get("/desktop/")

    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert "headless" in response.json()["error"].lower()


def test_real_backend_mounts_desktop_beside_dashboard(tmp_path, monkeypatch):
    import hermes_cli.desktop_web as desktop_web
    import hermes_cli.web_server as web_server

    dist = tmp_path / "desktop_web_dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html><head></head><body>Desktop mount</body></html>", encoding="utf-8")
    monkeypatch.setattr(desktop_web, "DESKTOP_WEB_DIST", dist)

    client = TestClient(web_server.app)
    response = client.get(
        "/desktop/",
        headers={web_server._SESSION_HEADER_NAME: web_server._SESSION_TOKEN},
    )

    assert response.status_code == 200
    assert "Desktop mount" in response.text

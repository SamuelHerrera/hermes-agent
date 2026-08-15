import pytest


def _client():
    try:
        from starlette.testclient import TestClient
    except ImportError:
        pytest.skip("fastapi/starlette not installed")

    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN

    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return client, _SESSION_HEADER_NAME


def test_codex_usage_route_returns_desktop_usage_payload(monkeypatch):
    from agent import account_usage

    client, _header = _client()
    payload = {
        "available": True,
        "status": "available",
        "provider": "openai-codex",
        "plan": "Pro",
        "used_percent": 72.0,
        "remaining_percent": 28.0,
        "reset_time": "2026-08-20T03:32:23+00:00",
        "reset_credits": 0,
        "buckets": [
            {
                "key": "primary_window",
                "label": "Session",
                "used_percent": 72.0,
                "remaining_percent": 28.0,
                "reset_time": "2026-08-20T03:32:23+00:00",
                "detail": None,
            }
        ],
    }
    monkeypatch.setattr(account_usage, "desktop_codex_usage", lambda: payload)

    response = client.get("/api/account/codex-usage")

    assert response.status_code == 200
    assert response.json() == payload


def test_codex_usage_route_requires_dashboard_session_token():
    client, header = _client()
    client.headers.pop(header, None)

    response = client.get("/api/account/codex-usage")

    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_codex_usage_route_fails_open_without_leaking_error(monkeypatch):
    from agent import account_usage

    client, _header = _client()

    def _raise_private_error():
        raise RuntimeError("Bearer private-token via https://chatgpt.com/backend-api/wham/usage")

    monkeypatch.setattr(account_usage, "desktop_codex_usage", _raise_private_error)

    response = client.get("/api/account/codex-usage")

    assert response.status_code == 200
    body = response.json()
    assert body == account_usage.unavailable_desktop_codex_usage()
    assert "private-token" not in response.text
    assert "Bearer" not in response.text
    assert "chatgpt.com" not in response.text

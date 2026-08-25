import json

from hermes_cli import web_server


def test_detach_expected_token_uses_authoritative_served_token(monkeypatch):
    monkeypatch.setattr(web_server, "_SESSION_TOKEN", "served-token")
    monkeypatch.setenv("HERMES_DASHBOARD_SESSION_TOKEN", "spawn-token")

    assert web_server._desktop_detach_expected_token() == "served-token"


def test_desktop_detach_capability_is_explicitly_advertised():
    assert web_server._desktop_detach_capability_status() == {
        "desktop_detach_lease_version": 1
    }


def test_detached_desktop_backend_lease_allows_exact_pid(tmp_path):
    lease = tmp_path / "desktop-detach.json"
    lease.write_text(
        json.dumps(
            {
                "version": 1,
                "records": [
                    {
                        "role": "primary",
                        "pid": 12345,
                        "baseUrl": "http://127.0.0.1:9119",
                        "token": "secret-token",
                        "nonce": "lease-nonce",
                        "expiresAt": 2_000,
                        "profile": "default",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    assert web_server._detached_desktop_backend_lease_allows_survival(
        str(lease), 12345, expected_token="secret-token", expected_nonce="lease-nonce", now_ms=1_000
    ) is True
    assert web_server._detached_desktop_backend_lease_allows_survival(
        str(lease), 54321, expected_token="secret-token", expected_nonce="lease-nonce", now_ms=1_000
    ) is False


def test_detached_desktop_backend_lease_rejects_malformed_or_remote(tmp_path):
    lease = tmp_path / "desktop-detach.json"
    lease.write_text(
        json.dumps(
            {
                "version": 1,
                "records": [
                    {"role": "primary", "pid": 12345, "baseUrl": "https://remote.example", "token": "secret-token", "nonce": "lease-nonce", "expiresAt": 2_000},
                    {"role": "primary", "pid": "bad", "baseUrl": "http://127.0.0.1:9119", "token": "secret-token", "nonce": "lease-nonce", "expiresAt": 2_000},
                ],
            }
        ),
        encoding="utf-8",
    )

    assert web_server._detached_desktop_backend_lease_allows_survival(
        str(lease), 12345, expected_token="secret-token", expected_nonce="lease-nonce", now_ms=1_000
    ) is False
    assert web_server._detached_desktop_backend_lease_allows_survival(
        str(tmp_path / "missing.json"), 12345, expected_token="secret-token", expected_nonce="lease-nonce", now_ms=1_000
    ) is False


def test_detached_desktop_backend_lease_rejects_mismatched_or_expired_credentials(tmp_path):
    lease = tmp_path / "desktop-detach.json"
    lease.write_text(
        json.dumps(
            {
                "version": 1,
                "records": [
                    {
                        "role": "primary",
                        "pid": 12345,
                        "baseUrl": "http://127.0.0.1:9119",
                        "token": "secret-token",
                        "nonce": "lease-nonce",
                        "expiresAt": 2_000,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    assert web_server._detached_desktop_backend_lease_allows_survival(
        str(lease), 12345, expected_token="wrong", expected_nonce="lease-nonce", now_ms=1_000
    ) is False
    assert web_server._detached_desktop_backend_lease_allows_survival(
        str(lease), 12345, expected_token="secret-token", expected_nonce="wrong", now_ms=1_000
    ) is False
    assert web_server._detached_desktop_backend_lease_allows_survival(
        str(lease), 12345, expected_token="secret-token", expected_nonce="lease-nonce", now_ms=2_001
    ) is False

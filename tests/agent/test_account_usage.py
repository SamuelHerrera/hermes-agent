import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from agent import account_usage


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, calls, payload):
        self.calls = calls
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, url, headers):
        self.calls.append({"url": url, "headers": headers})
        return _FakeResponse(self.payload)


@pytest.fixture
def codex_usage_payload():
    return {
        "plan_type": "plus",
        "rate_limit": {
            "primary_window": {
                "used_percent": 21,
                "reset_at": 1779846359,
            },
            "secondary_window": {
                "used_percent": 4,
                "reset_at": 1780230796,
            },
        },
        "credits": {"has_credits": False},
    }


def test_codex_usage_prefers_explicit_live_agent_credentials(monkeypatch, codex_usage_payload):
    calls = []
    monkeypatch.setattr(
        account_usage.httpx,
        "Client",
        lambda timeout: _FakeClient(calls, codex_usage_payload),
    )
    monkeypatch.setattr(
        account_usage,
        "resolve_codex_runtime_credentials",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("legacy auth should not be used")),
    )

    snapshot = account_usage.fetch_account_usage(
        "openai-codex",
        base_url="https://chatgpt.com/backend-api/codex",
        api_key="live-agent-token",
    )

    assert snapshot is not None
    assert snapshot.provider == "openai-codex"
    assert snapshot.plan == "Plus"
    assert [w.label for w in snapshot.windows] == ["Session", "Weekly"]
    assert snapshot.windows[0].used_percent == 21
    assert calls[0]["url"] == "https://chatgpt.com/backend-api/wham/usage"
    assert calls[0]["headers"]["Authorization"] == "Bearer live-agent-token"


def test_desktop_codex_usage_serialization_is_sanitized():
    reset_at = datetime(2026, 5, 1, 12, 30, tzinfo=timezone.utc)
    snapshot = account_usage.AccountUsageSnapshot(
        provider="openai-codex",
        source="usage_api",
        fetched_at=datetime(2026, 4, 30, 9, 0, tzinfo=timezone.utc),
        plan="Plus",
        windows=(
            account_usage.AccountUsageWindow(
                key="primary_window",
                label="Session",
                used_percent=40.4,
                reset_at=reset_at,
            ),
            account_usage.AccountUsageWindow(
                key="secondary_window",
                label="Weekly",
                used_percent=12,
            ),
            account_usage.AccountUsageWindow(
                key="burst_window",
                label="Burst Window",
                used_percent=5,
                detail="temporary bucket",
            ),
        ),
        metadata={
            "account_id": "acct_should_not_escape",
            "authorization": "Bearer should-not-escape",
            "endpoint": "https://chatgpt.com/backend-api/wham/usage",
            "reset_credits_available": 2,
            "session_token": "token_should_not_escape",
        },
    )

    result = account_usage.serialize_codex_usage_for_desktop(snapshot)

    assert result == {
        "available": True,
        "status": "available",
        "provider": "openai-codex",
        "plan": "Plus",
        "used_percent": 40.4,
        "remaining_percent": 59.6,
        "reset_time": "2026-05-01T12:30:00+00:00",
        "reset_credits": 2,
        "buckets": [
            {
                "key": "primary_window",
                "label": "Session",
                "used_percent": 40.4,
                "remaining_percent": 59.6,
                "reset_time": "2026-05-01T12:30:00+00:00",
                "detail": None,
            },
            {
                "key": "secondary_window",
                "label": "Weekly",
                "used_percent": 12.0,
                "remaining_percent": 88.0,
                "reset_time": None,
                "detail": None,
            },
            {
                "key": "burst_window",
                "label": "Burst Window",
                "used_percent": 5.0,
                "remaining_percent": 95.0,
                "reset_time": None,
                "detail": "temporary bucket",
            },
        ],
    }
    encoded = json.dumps(result)
    assert "Bearer" not in encoded
    assert "Authorization" not in encoded
    assert "chatgpt.com" not in encoded
    assert "account_id" not in encoded
    assert "authorization" not in encoded.lower()
    assert "endpoint" not in encoded
    assert "session_token" not in encoded
    assert "should-not-escape" not in encoded
    assert "token_should_not_escape" not in encoded


def test_desktop_codex_usage_failure_returns_sanitized_unavailable(monkeypatch):
    monkeypatch.setattr(
        account_usage,
        "fetch_account_usage",
        lambda provider: (_ for _ in ()).throw(
            RuntimeError("Bearer private-token via https://chatgpt.com/backend-api/wham/usage")
        ),
    )

    result = account_usage.desktop_codex_usage()

    assert result == account_usage.unavailable_desktop_codex_usage()
    encoded = json.dumps(result)
    assert "private-token" not in encoded
    assert "Bearer" not in encoded
    assert "chatgpt.com" not in encoded


def test_desktop_codex_usage_unavailable_shape_is_stable():
    assert account_usage.serialize_codex_usage_for_desktop(None) == {
        "available": False,
        "status": "unavailable",
        "provider": "openai-codex",
        "plan": None,
        "used_percent": None,
        "remaining_percent": None,
        "reset_time": None,
        "reset_credits": 0,
        "buckets": [],
    }


def test_codex_usage_falls_back_to_native_credential_pool(monkeypatch, codex_usage_payload):
    calls = []
    monkeypatch.setattr(
        account_usage.httpx,
        "Client",
        lambda timeout: _FakeClient(calls, codex_usage_payload),
    )
    # Pool fallback fires only on AuthError (the documented "no creds" mode of
    # the resolver), NOT on arbitrary exceptions — see the transient-error guard
    # test below.
    monkeypatch.setattr(
        account_usage,
        "resolve_codex_runtime_credentials",
        lambda **kwargs: (_ for _ in ()).throw(
            account_usage.AuthError("no singleton auth", provider="openai-codex", code="codex_auth_missing")
        ),
    )

    pool_entry = SimpleNamespace(
        runtime_api_key="pooled-token",
        runtime_base_url="https://chatgpt.com/backend-api/codex",
    )
    pool = SimpleNamespace(select=lambda: pool_entry)

    import agent.credential_pool as credential_pool

    monkeypatch.setattr(credential_pool, "load_pool", lambda provider: pool)

    snapshot = account_usage.fetch_account_usage("openai-codex")

    assert snapshot is not None
    assert snapshot.windows[0].label == "Session"
    assert snapshot.windows[1].label == "Weekly"
    assert calls[0]["url"] == "https://chatgpt.com/backend-api/wham/usage"
    assert calls[0]["headers"]["Authorization"] == "Bearer pooled-token"
    # Pool creds have no account_id concept — the ChatGPT-Account-Id header must
    # be omitted rather than sent stale/wrong.
    assert "ChatGPT-Account-Id" not in calls[0]["headers"]


def test_codex_usage_keeps_extra_windows_and_reset_credit_count(monkeypatch):
    calls = []
    payload = {
        "plan_type": "pro",
        "rate_limit": {
            "primary_window": {"used_percent": 50, "reset_at": 1779846359},
            "secondary_window": {"used_percent": 20, "reset_at": 1780230796},
            "burst_window": {"used_percent": 3, "reset_at": 1780230999},
        },
        "rate_limit_reset_credits": {"available_count": 4},
    }
    monkeypatch.setattr(
        account_usage.httpx,
        "Client",
        lambda timeout: _FakeClient(calls, payload),
    )
    monkeypatch.setattr(
        account_usage,
        "resolve_codex_runtime_credentials",
        lambda **kwargs: {
            "api_key": "singleton-token",
            "base_url": "https://chatgpt.com/backend-api/codex",
        },
    )
    monkeypatch.setattr(account_usage, "_read_codex_tokens", lambda: {"tokens": {}})

    desktop_usage = account_usage.desktop_codex_usage()

    assert desktop_usage["plan"] == "Pro"
    assert desktop_usage["reset_credits"] == 4
    assert [bucket["key"] for bucket in desktop_usage["buckets"]] == [
        "primary_window",
        "secondary_window",
        "burst_window",
    ]
    assert desktop_usage["buckets"][2]["label"] == "Burst Window"


def test_codex_usage_account_id_read_failure_keeps_singleton_token(monkeypatch, codex_usage_payload):
    """When the resolver succeeds but the separate account_id read raises, the
    working singleton token must still be used (best-effort account_id), NOT
    abandoned in favor of a header-less pool credential."""
    calls = []
    monkeypatch.setattr(
        account_usage.httpx,
        "Client",
        lambda timeout: _FakeClient(calls, codex_usage_payload),
    )
    monkeypatch.setattr(
        account_usage,
        "resolve_codex_runtime_credentials",
        lambda **kwargs: {
            "api_key": "singleton-token",
            "base_url": "https://chatgpt.com/backend-api/codex",
        },
    )
    monkeypatch.setattr(
        account_usage,
        "_read_codex_tokens",
        lambda *a, **k: (_ for _ in ()).throw(
            account_usage.AuthError("partial store", provider="openai-codex", code="codex_auth_invalid_shape")
        ),
    )

    import agent.credential_pool as credential_pool

    monkeypatch.setattr(
        credential_pool,
        "load_pool",
        lambda provider: (_ for _ in ()).throw(AssertionError("pool must not be consulted")),
    )

    snapshot = account_usage.fetch_account_usage("openai-codex")

    assert snapshot is not None
    assert calls[0]["headers"]["Authorization"] == "Bearer singleton-token"
    # account_id read failed → header omitted, but the singleton token is kept.
    assert "ChatGPT-Account-Id" not in calls[0]["headers"]




# ── Banked rate-limit reset credits (`/usage reset`) ─────────────────────────


class _FakeResetClient:
    """GET returns the usage payload; POST returns the consume payload."""

    def __init__(self, calls, usage_payload, consume_payload=None):
        self.calls = calls
        self.usage_payload = usage_payload
        self.consume_payload = consume_payload or {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, url, headers):
        self.calls.append({"method": "GET", "url": url, "headers": headers})
        return _FakeResponse(self.usage_payload)

    def post(self, url, headers=None, json=None):
        self.calls.append({"method": "POST", "url": url, "headers": headers, "json": json})
        return _FakeResponse(self.consume_payload)


def _usage_payload_with_resets(primary_used, secondary_used, banked):
    return {
        "plan_type": "plus",
        "rate_limit": {
            "primary_window": {"used_percent": primary_used, "reset_at": 1779846359},
            "secondary_window": {"used_percent": secondary_used, "reset_at": 1780230796},
        },
        "rate_limit_reset_credits": {"available_count": banked},
        "credits": {"has_credits": False},
    }
















def test_redeem_missing_credentials_reports_unavailable(monkeypatch):
    monkeypatch.setattr(
        account_usage,
        "_resolve_codex_usage_credentials",
        lambda base_url, api_key: (_ for _ in ()).throw(RuntimeError("no creds")),
    )

    result = account_usage.redeem_codex_reset_credit()

    assert result.status == "unavailable"
    assert "hermes auth" in result.message

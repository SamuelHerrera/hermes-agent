from typing import cast
from types import SimpleNamespace

from starlette.requests import Request

from hermes_cli import web_server


def _request(token: str) -> Request:
    return cast(Request, SimpleNamespace(query_params={"token": token}))


def test_query_token_accepts_kanban_attachment_download_prefix(monkeypatch):
    monkeypatch.setattr(web_server, "_SESSION_TOKEN", "secret-token")

    assert web_server._has_valid_query_token(
        _request("secret-token"),
        "/api/plugins/kanban/attachments/7",
    )


def test_query_token_rejects_wrong_token_for_kanban_attachment_download(monkeypatch):
    monkeypatch.setattr(web_server, "_SESSION_TOKEN", "secret-token")

    assert not web_server._has_valid_query_token(
        _request("wrong-token"),
        "/api/plugins/kanban/attachments/7",
    )


def test_query_token_stays_restricted_for_other_plugin_api_paths(monkeypatch):
    monkeypatch.setattr(web_server, "_SESSION_TOKEN", "secret-token")

    assert not web_server._has_valid_query_token(
        _request("secret-token"),
        "/api/plugins/kanban/tasks/t_123/comments",
    )

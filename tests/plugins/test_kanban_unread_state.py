"""Tests for Kanban per-reader unread state exposed through dashboard API."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hermes_cli import kanban_db as kb


def _load_plugin_router():
    repo_root = Path(__file__).resolve().parents[2]
    plugin_file = repo_root / "plugins" / "kanban" / "dashboard" / "plugin_api.py"
    spec = importlib.util.spec_from_file_location(
        "hermes_dashboard_plugin_kanban_unread_test", plugin_file,
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod.router


@pytest.fixture
def kanban_home(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    kb.init_db()
    return home


@pytest.fixture
def client(kanban_home):
    app = FastAPI()
    app.include_router(_load_plugin_router(), prefix="/api/plugins/kanban")
    return TestClient(app)


def _done_task() -> str:
    with kb.connect() as conn:
        tid = kb.create_task(conn, title="done card", assignee="default")
        assert kb.complete_task(conn, tid, summary="finished")
        return tid


def _find_task(board_payload: dict, task_id: str) -> dict:
    for column in board_payload["columns"]:
        for task in column["tasks"]:
            if task["id"] == task_id:
                return task
    raise AssertionError(f"task {task_id} not found in board payload")


def test_board_and_detail_include_per_reader_unread_state(client):
    tid = _done_task()

    board = client.get("/api/plugins/kanban/board?reader_id=alice").json()
    card = _find_task(board, tid)
    assert card["is_unread"] is True
    assert card["latest_unread_event_id"] > 0
    assert card["last_read_event_id"] == 0

    detail = client.get(f"/api/plugins/kanban/tasks/{tid}?reader_id=alice").json()
    assert detail["task"]["is_unread"] is True
    assert detail["task"]["latest_unread_event_id"] == card["latest_unread_event_id"]


def test_mark_read_endpoint_clears_only_current_reader(client):
    tid = _done_task()

    read = client.post(f"/api/plugins/kanban/tasks/{tid}/read?reader_id=alice")
    assert read.status_code == 200, read.text
    payload = read.json()
    assert payload["task_id"] == tid
    assert payload["is_unread"] is False
    assert payload["last_read_event_id"] == payload["latest_unread_event_id"]

    alice_board = client.get("/api/plugins/kanban/board?reader_id=alice").json()
    bob_board = client.get("/api/plugins/kanban/board?reader_id=bob").json()
    assert _find_task(alice_board, tid)["is_unread"] is False
    assert _find_task(bob_board, tid)["is_unread"] is True

"""Tests for grouped Kanban agent activity steps."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from hermes_cli import kanban_db as kb


@pytest.fixture
def kanban_home(tmp_path, monkeypatch):
    """Isolated HERMES_HOME with an empty Kanban DB."""
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    kb.init_db()
    return home


def test_agent_activity_step_updates_existing_group_without_exposing_raw_details(kanban_home):
    with kb.connect() as conn:
        tid = kb.create_task(conn, title="group worker steps", assignee="worker-a")
        claimed = kb.claim_task(conn, tid, claimer="worker-a:1")
        assert claimed is not None
        run_id = claimed.current_run_id

        first_id = kb.record_agent_activity_step(
            conn,
            tid,
            run_id=run_id,
            step_type="file_inspection",
            group_key=f"run:{run_id}:file_inspection:source-context",
            title="Inspecting relevant files",
            summary="The agent is looking through related code to understand the current behavior.",
            status="progress",
            details={"raw_sources": [{"kind": "tool", "name": "search_files"}]},
        )
        second_id = kb.record_agent_activity_step(
            conn,
            tid,
            run_id=run_id,
            step_type="file_inspection",
            group_key=f"run:{run_id}:file_inspection:source-context",
            title="Inspecting relevant files",
            summary="The agent finished checking the related code and logs.",
            status="succeeded",
            details={"raw_sources": [{"kind": "tool", "name": "read_file"}]},
        )

        assert second_id == first_id
        rows = [row for row in kb.list_activity_events(conn, tid) if row.source_kind == "agent_step"]
        assert len(rows) == 1
        row = rows[0]
        assert row.semantic_type == "agent.file_inspection"
        assert row.title == "Inspecting relevant files"
        assert row.summary == "The agent finished checking the related code and logs."
        assert row.status == "succeeded"
        assert row.details is not None
        assert row.details["updates_count"] == 2
        assert row.details["raw_sources"] == [
            {"kind": "tool", "name": "search_files"},
            {"kind": "tool", "name": "read_file"},
        ]

        timeline = kb.list_activity_timeline(conn, tid)
        item = next(item for item in timeline if item.get("source_kind") == "agent_step")
        assert item["type"] == "agent.file_inspection"
        assert item["description"] == "The agent finished checking the related code and logs."
        assert item["started_at"] == row.created_at
        assert isinstance(item["ended_at"], int)
        rendered = json.dumps(item)
        assert "grep" not in rendered
        assert "pytest -q" not in rendered


def test_handle_function_call_records_grouped_kanban_tool_step(kanban_home, monkeypatch):
    from tools.registry import registry
    import model_tools

    with kb.connect() as conn:
        tid = kb.create_task(conn, title="tool step integration", assignee="worker-a")
        claimed = kb.claim_task(conn, tid, claimer="worker-a:1")
        assert claimed is not None
        run_id = claimed.current_run_id

    monkeypatch.setenv("HERMES_KANBAN_TASK", tid)
    monkeypatch.setenv("HERMES_KANBAN_RUN_ID", str(run_id))
    monkeypatch.setenv("HERMES_PROFILE", "worker-a")
    monkeypatch.setattr(registry, "dispatch", lambda *args, **kwargs: '{"matches": []}')

    result = model_tools.handle_function_call(
        "search_files",
        {"pattern": "activity_timeline", "path": "plugins/kanban"},
        task_id="session-1",
        session_id="session-1",
    )
    assert json.loads(result) == {"matches": []}

    with kb.connect() as conn:
        rows = [row for row in kb.list_activity_events(conn, tid) if row.source_kind == "agent_step"]
    assert len(rows) == 1
    assert rows[0].semantic_type == "agent.file_inspection"
    assert rows[0].title == "Inspecting relevant files"
    assert rows[0].status == "succeeded"
    assert rows[0].details["tools"] == ["search_files"]

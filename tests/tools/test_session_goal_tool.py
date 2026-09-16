"""Session goals use the real store, never Kanban or renderer input."""
import importlib
import json

import pytest

from gateway.session_context import scoped_current_session_id
from hermes_cli import goals
from tools import desktop_ui
from tools.registry import registry


@pytest.fixture(autouse=True)
def isolated_goals(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    goals._DB_CACHE.clear()
    yield
    for db in goals._DB_CACHE.values():
        db.close()
    goals._DB_CACHE.clear()


def call_goal(**args):
    importlib.import_module("tools.session_goal_tool")
    return json.loads(registry.get_entry("session_goal").handler(args))


def test_set_goal_in_current_chat_despite_inherited_kanban_marker(monkeypatch):
    monkeypatch.setenv("HERMES_DELEGATED_CHILD_CONTEXT", "1")
    monkeypatch.setenv("HERMES_SESSION_ID", "stale-other-chat")
    events = []
    monkeypatch.setattr(desktop_ui, "_emit", lambda sid, event, data: events.append((event, data)))
    with scoped_current_session_id("current-chat"):
        result = call_goal(action="set", text="Ship the browser router", max_turns=7)
    assert result["success"] is True
    state = goals.GoalManager("current-chat").state
    assert state.goal == "Ship the browser router"
    assert state.max_turns == 7
    assert state.status == "active"
    assert goals.load_goal("stale-other-chat") is None
    assert events[-1][0] == "status.update"
    assert events[-1][1]["kind"] == "goal"


def test_controls_share_the_slash_goal_store():
    with scoped_current_session_id("current-chat"):
        assert call_goal(action="set", text="Finish the task")["success"]
        assert call_goal(action="pause")["state"]["status"] == "paused"
        assert call_goal(action="resume")["state"]["status"] == "active"
        assert call_goal(action="status")["state"]["goal"] == "Finish the task"
        assert call_goal(action="clear")["state"] is None
    assert not goals.GoalManager("current-chat").has_goal()


def test_missing_identity_does_not_fall_back_to_another_chat():
    with scoped_current_session_id(""):
        assert "error" in call_goal(action="set", text="Do not persist")


@pytest.mark.parametrize("args", [
    {"action": "set", "text": " "},
    {"action": "set", "text": "task", "max_turns": -1},
    {"action": "set", "text": "task", "max_turns": True},
    {"action": "unknown"},
])
def test_invalid_input_leaves_existing_goal_untouched(args):
    goals.GoalManager("current-chat").set("Original")
    with scoped_current_session_id("current-chat"):
        assert "error" in call_goal(**args)
    assert goals.load_goal("current-chat").goal == "Original"


def test_reports_failed_persistence(monkeypatch):
    monkeypatch.setattr(goals, "save_goal", lambda *args: None)
    with scoped_current_session_id("current-chat"):
        assert "error" in call_goal(action="set", text="Not saved")

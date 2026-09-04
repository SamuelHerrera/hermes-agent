"""Regression tests for invalid/None terminal command handling."""

import json
from unittest.mock import patch

from tools.terminal_tool import _handle_terminal, _transform_sudo_command, terminal_tool


def test_transform_sudo_command_none_returns_cleanly():
    transformed, sudo_stdin = _transform_sudo_command(None)

    assert transformed is None
    assert sudo_stdin is None


def test_terminal_tool_none_command_returns_clean_error():
    result = json.loads(terminal_tool(None))  # type: ignore[arg-type]

    assert result["exit_code"] == -1
    assert result["status"] == "error"
    assert "expected string" in result["error"].lower()
    assert "nonetype" in result["error"].lower()


def test_terminal_handler_forwards_originating_turn_id():
    with patch("tools.terminal_tool.terminal_tool", return_value="{}") as terminal:
        _handle_terminal(
            {"command": "true"},
            task_id="stable-session-task",
            turn_id="unique-turn-id",
        )

    assert terminal.call_args.kwargs["origin_turn_id"] == "unique-turn-id"

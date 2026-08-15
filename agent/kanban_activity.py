"""User-facing Kanban Activity steps for agent tool work.

This module converts low-level tool calls into coarse, durable Activity
milestones for dispatcher-owned Kanban workers. It is deliberately
best-effort: failures here must never break the agent loop.
"""
from __future__ import annotations

import os
import re
from typing import Any, Optional


_INSPECTION_TOOLS = {
    "read_file",
    "search_files",
    "vision_analyze",
    "browser_exec",
    "computer_use",
}
_CONTEXT_TOOLS = {
    "skill_view",
    "skills_list",
    "session_search",
    "hindsight_recall",
    "hindsight_reflect",
    "kanban_show",
    "kanban_attachments",
    "tool_search",
    "tool_describe",
}
_EDIT_TOOLS = {
    "write_file",
    "patch",
    "kanban_attach",
    "kanban_attach_url",
}
_REVIEW_HANDOFF_TOOLS = {
    "kanban_create",
    "kanban_link",
    "kanban_comment",
    "kanban_request_review",
    "kanban_request_changes",
}
_LIFECYCLE_TOOLS = {
    "kanban_complete",
    "kanban_block",
    "kanban_heartbeat",
}

_VERIFY_COMMAND_RE = re.compile(
    r"\b(pytest|vitest|jest|npm\s+test|pnpm\s+test|yarn\s+test|tsc|mypy|ruff|eslint|cargo\s+test|go\s+test|scripts/run_tests\.sh|make\s+test)\b",
    re.IGNORECASE,
)
_BUILD_COMMAND_RE = re.compile(
    r"\b(npm\s+run\s+build|pnpm\s+build|yarn\s+build|cargo\s+build|go\s+build)\b",
    re.IGNORECASE,
)
_INSPECT_COMMAND_RE = re.compile(
    r"\b(git\s+(status|diff|show|log)|rg\b|grep\b|find\b|ls\b|pwd\b)\b",
    re.IGNORECASE,
)

_STEP_COPY = {
    "planning": (
        "Understanding the request",
        "The agent is reviewing the task details and prior findings before deciding how to proceed.",
        "compass",
    ),
    "context": (
        "Gathering context",
        "The agent is collecting background information so it can avoid repeating known mistakes.",
        "book-open",
    ),
    "file_inspection": (
        "Inspecting relevant files",
        "The agent is looking through the related code and logs to understand the current behavior.",
        "search",
    ),
    "analysis": (
        "Connecting the findings",
        "The agent is turning the available evidence into a clear next step.",
        "brain",
    ),
    "code_changes": (
        "Updating the implementation",
        "The agent is making the changes needed for this task.",
        "edit-3",
    ),
    "verification": (
        "Checking the result",
        "The agent is running checks to make sure the changes behave correctly.",
        "check-circle",
    ),
    "error_retry": (
        "Recovering from an issue",
        "Something did not work as expected, so the agent is deciding how to continue safely.",
        "alert-triangle",
    ),
    "review_handoff": (
        "Preparing a handoff",
        "The agent is packaging context so another worker or reviewer can continue.",
        "send",
    ),
}


def _dispatcher_owned_worker() -> bool:
    if not os.environ.get("HERMES_KANBAN_TASK"):
        return False
    try:
        from agent.delegation_context import is_dispatcher_owned_worker_context

        return bool(is_dispatcher_owned_worker_context())
    except Exception:
        return True


def _run_id_from_env() -> Optional[int]:
    raw = os.environ.get("HERMES_KANBAN_RUN_ID", "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _tool_target(tool_name: str, args: dict[str, Any]) -> str:
    if tool_name == "terminal":
        command = str(args.get("command") or "")
        if _VERIFY_COMMAND_RE.search(command) or _BUILD_COMMAND_RE.search(command):
            return "checks"
        if _INSPECT_COMMAND_RE.search(command):
            return "source-context"
        return "project-command"
    if tool_name in {"read_file", "search_files", "vision_analyze"}:
        return "source-context"
    if tool_name in _EDIT_TOOLS:
        return "implementation"
    if tool_name in _CONTEXT_TOOLS:
        return "task-context"
    if tool_name in _REVIEW_HANDOFF_TOOLS:
        return "handoff"
    return "task-work"


def _classify_tool(tool_name: str, args: dict[str, Any], observer_status: str) -> Optional[str]:
    if tool_name in _LIFECYCLE_TOOLS:
        return None
    if observer_status == "error":
        return "error_retry"
    if tool_name == "terminal":
        command = str(args.get("command") or "")
        if _VERIFY_COMMAND_RE.search(command) or _BUILD_COMMAND_RE.search(command):
            return "verification"
        if _INSPECT_COMMAND_RE.search(command):
            return "file_inspection"
        return "analysis"
    if tool_name in _INSPECTION_TOOLS:
        return "file_inspection"
    if tool_name in _CONTEXT_TOOLS:
        return "planning" if tool_name == "kanban_show" else "context"
    if tool_name in _EDIT_TOOLS:
        return "code_changes"
    if tool_name in _REVIEW_HANDOFF_TOOLS:
        return "review_handoff"
    if tool_name in {"process", "execute_code"}:
        return "verification" if tool_name == "process" else "analysis"
    return "analysis"


def _status_for_phase(phase: str, observer_status: str) -> str:
    if phase == "start":
        return "progress"
    return "failed" if observer_status == "error" else "succeeded"


def _tone_for_status(status: str) -> str:
    if status == "failed":
        return "warning"
    if status == "progress":
        return "current"
    return "done"


def record_kanban_tool_activity(
    tool_name: str,
    args: dict[str, Any] | None,
    *,
    observer_status: str = "ok",
    phase: str = "end",
    duration_ms: int = 0,
    error_type: Optional[str] = None,
    error_message: Optional[str] = None,
) -> Optional[int]:
    """Record or update one grouped Kanban Activity step for a tool call."""
    if not _dispatcher_owned_worker():
        return None
    task_id = os.environ.get("HERMES_KANBAN_TASK", "").strip()
    if not task_id:
        return None
    safe_args = args if isinstance(args, dict) else {}
    step_type = _classify_tool(tool_name, safe_args, observer_status)
    if step_type is None:
        return None
    run_id = _run_id_from_env()
    target = _tool_target(tool_name, safe_args)
    title, summary, icon = _STEP_COPY[step_type]
    status = _status_for_phase(phase, observer_status)
    details: dict[str, Any] = {
        "tools": [tool_name],
        "raw_sources": [{"kind": "tool", "name": tool_name}],
    }
    if duration_ms > 0:
        details["duration_ms"] = int(duration_ms)
    if error_type:
        details["error_type"] = error_type
    if error_message:
        details["error_message"] = str(error_message)[:500]
    try:
        from hermes_cli import kanban_db as kb

        with kb.connect() as conn:
            return kb.record_agent_activity_step(
                conn,
                task_id,
                run_id=run_id,
                step_type=step_type,
                group_key=f"run:{run_id or task_id}:{step_type}:{target}",
                title=title,
                summary=summary,
                status=status,
                tone=_tone_for_status(status),
                icon=icon,
                details=details,
                actor_id=os.environ.get("HERMES_PROFILE") or None,
            )
    except Exception:
        return None

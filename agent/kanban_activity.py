"""User-facing Kanban Activity steps for agent tool work.

This module converts low-level tool calls into coarse, durable Activity
milestones for dispatcher-owned Kanban workers. It is deliberately
best-effort: failures here must never break the agent loop.
"""
from __future__ import annotations

import os
import hashlib
import json
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
_SECRET_KEY_RE = re.compile(
    r"(?i)(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|cookie|credential|password|secret|token)"
)
_ASSIGNMENT_SECRET_RE = re.compile(
    r"(?i)\b([a-z0-9_.-]*(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|cookie|credential|password|secret|token)[a-z0-9_.-]*)\s*[:=]\s*([^\s,;]+)"
)
_MAX_TITLE_CHARS = 160
_MAX_SUMMARY_CHARS = 500
_MAX_PREVIEW_CHARS = 4096
_MAX_RAW_PREVIEW_CHARS = 16_384

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


def _truncate_text(value: Any, limit: int) -> str:
    text = str(value or "")
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def _redact_text(value: Any, *, limit: int = _MAX_SUMMARY_CHARS) -> str:
    text = _truncate_text(value, limit)
    return _ASSIGNMENT_SECRET_RE.sub(lambda m: f"{m.group(1)}=[redacted]", text)


def _redact_value(key: str, value: Any, *, limit: int = _MAX_SUMMARY_CHARS) -> Any:
    if _SECRET_KEY_RE.search(str(key)):
        return "[redacted]"
    if isinstance(value, str):
        return _redact_text(value, limit=limit)
    if isinstance(value, dict):
        return {
            str(k): _redact_value(str(k), v, limit=limit)
            for k, v in list(value.items())[:50]
        }
    if isinstance(value, list):
        return [_redact_value(key, v, limit=limit) for v in value[:50]]
    return value


def _safe_args(args: dict[str, Any]) -> dict[str, Any]:
    return {str(k): _redact_value(str(k), v, limit=1024) for k, v in args.items()}


def _parse_result(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        return result
    if not isinstance(result, str) or not result.strip():
        return {}
    try:
        parsed = json.loads(result)
    except Exception:
        return {"preview": _redact_text(result, limit=_MAX_RAW_PREVIEW_CHARS)}
    return parsed if isinstance(parsed, dict) else {"value": parsed}


def _child_id(tool_name: str, title: str, summary: str = "") -> str:
    digest = hashlib.sha1(f"{tool_name}\0{title}\0{summary}".encode("utf-8", "replace")).hexdigest()[:12]
    return f"tool-{tool_name}-{digest}"


def _duration_summary(duration_ms: int) -> Optional[str]:
    if duration_ms <= 0:
        return None
    if duration_ms < 1000:
        return f"{duration_ms}ms"
    return f"{duration_ms / 1000:.1f}s"


def _count_from_result(result: dict[str, Any], *keys: str) -> Optional[int]:
    for key in keys:
        value = result.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            return value
        if isinstance(value, list):
            return len(value)
    return None


def _output_preview(result: dict[str, Any]) -> Optional[dict[str, Any]]:
    output: dict[str, Any] = {}
    for source_key, dest_key in (
        ("output", "stdout_preview"),
        ("stdout", "stdout_preview"),
        ("stderr", "stderr_preview"),
        ("error", "stderr_preview"),
        ("preview", "stdout_preview"),
    ):
        value = result.get(source_key)
        if isinstance(value, str) and value.strip() and dest_key not in output:
            preview = _redact_text(value, limit=_MAX_PREVIEW_CHARS)
            output[dest_key] = preview
            stream = "stdout" if dest_key == "stdout_preview" else "stderr"
            output[f"total_{stream}_bytes"] = len(value.encode("utf-8", "replace"))
            output["truncated"] = output.get("truncated") or preview != value
            output["redacted"] = output.get("redacted") or preview != _truncate_text(value, _MAX_PREVIEW_CHARS)
    return output or None


def _tool_evidence(
    tool_name: str,
    args: dict[str, Any],
    *,
    result: Any = None,
    observer_status: str = "ok",
    phase: str = "end",
    duration_ms: int = 0,
    error_type: Optional[str] = None,
    error_message: Optional[str] = None,
) -> dict[str, Any]:
    """Build bounded, redacted concrete evidence for Activity details."""
    safe_args = _safe_args(args)
    parsed = _parse_result(result)
    details: dict[str, Any] = {
        "tools": [tool_name],
        "raw_sources": [{"kind": "tool", "name": tool_name}],
    }
    if phase != "end":
        return details
    child: dict[str, Any] = {
        "type": "agent.tool_call",
        "title": tool_name.replace("_", " "),
        "status": "failed" if observer_status == "error" else "succeeded",
    }
    summary_parts: list[str] = []
    files: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    duration = _duration_summary(duration_ms)

    if tool_name == "terminal":
        command = _redact_text(safe_args.get("command"), limit=240)
        exit_code = parsed.get("exit_code")
        child["type"] = "agent.command"
        child["title"] = _truncate_text(f"Ran {command}" if command else "Ran terminal command", _MAX_TITLE_CHARS)
        bits = []
        if duration:
            bits.append(duration)
        if isinstance(exit_code, int):
            bits.append(f"exit {exit_code}")
        if safe_args.get("workdir"):
            bits.append(f"cwd {safe_args.get('workdir')}")
        child["summary"] = " · ".join(bits) or None
        details["command"] = {
            "text": command,
            "cwd": safe_args.get("workdir"),
            "exit_code": exit_code if isinstance(exit_code, int) else None,
        }
        if command:
            summary_parts.append(child["title"])
    elif tool_name == "read_file":
        path = _redact_text(safe_args.get("path"), limit=220).strip()
        offset = safe_args.get("offset")
        total_lines = parsed.get("total_lines")
        raw_content = parsed.get("content")
        content = raw_content if isinstance(raw_content, str) else ""
        returned_lines = content.count("\n") + (1 if content else 0)
        line_suffix = f":{offset}" if offset else ""
        child["type"] = "agent.file_read"
        child["title"] = _truncate_text(f"Read {path}{line_suffix}" if path else "Read file", _MAX_TITLE_CHARS)
        child["summary"] = (
            f"Returned {returned_lines} of {total_lines} lines" if isinstance(total_lines, int) else None
        )
        if path:
            files.append({"path": path, "action": "read", "line_start": offset if isinstance(offset, int) else None})
            summary_parts.append(child["title"])
    elif tool_name == "search_files":
        pattern = _redact_text(safe_args.get("pattern"), limit=120)
        path = _redact_text(safe_args.get("path") or ".", limit=220).strip()
        count = _count_from_result(parsed, "total_count", "matches")
        child["type"] = "agent.file_search"
        child["title"] = _truncate_text(f"Searched {pattern}" if pattern else "Searched files", _MAX_TITLE_CHARS)
        child["summary"] = (
            f"Found {count} match{'es' if count != 1 else ''} under {path}" if count is not None else f"Searched under {path}"
        )
        if count is not None:
            counts["matches"] = count
        files.append({"path": path, "action": "searched", "matches": count})
        summary_parts.append(child["title"])
    elif tool_name in {"patch", "write_file"}:
        path = _redact_text(safe_args.get("path"), limit=220).strip()
        mode = str(safe_args.get("mode") or "")
        diff = parsed.get("diff") if isinstance(parsed.get("diff"), str) else ""
        additions = len(re.findall(r"^\+(?!\+\+\+)", diff, flags=re.MULTILINE)) if diff else None
        deletions = len(re.findall(r"^-(?!---)", diff, flags=re.MULTILINE)) if diff else None
        action = "edited" if tool_name == "patch" or mode == "patch" else "created"
        child["type"] = "agent.file_edit"
        child["title"] = _truncate_text(f"Edited {path}" if path else f"{tool_name.replace('_', ' ').title()} applied", _MAX_TITLE_CHARS)
        edit_bits = []
        if additions is not None or deletions is not None:
            edit_bits.append(f"+{additions or 0}/-{deletions or 0}")
        if parsed.get("verified") is True:
            edit_bits.append("verified")
        child["summary"] = " · ".join(edit_bits) or None
        if path:
            files.append({"path": path, "action": action, "additions": additions, "deletions": deletions})
            summary_parts.append(child["title"])
    elif tool_name in _REVIEW_HANDOFF_TOOLS or tool_name in _LIFECYCLE_TOOLS:
        target_task = safe_args.get("task_id") or os.environ.get("HERMES_KANBAN_TASK")
        child["type"] = "agent.handoff"
        child["title"] = _truncate_text(f"Used {tool_name.replace('_', ' ')}", _MAX_TITLE_CHARS)
        if target_task:
            child["summary"] = f"Target task {target_task}"
        summary_parts.append(child["title"])
    else:
        child["title"] = _truncate_text(f"Used {tool_name.replace('_', ' ')}", _MAX_TITLE_CHARS)
        if duration:
            child["summary"] = duration
        summary_parts.append(child["title"])

    if duration_ms > 0:
        details["duration_ms"] = int(duration_ms)
    if files:
        details["files"] = files
        counts["files"] = len({f.get("path") for f in files if f.get("path")})
    counts["tools"] = 1
    if counts:
        details["counts"] = counts
    output = _output_preview(parsed)
    if output:
        details["output"] = output
    if error_type or error_message or observer_status == "error":
        failure_message = _redact_text(error_message or parsed.get("error") or "Tool failed", limit=_MAX_SUMMARY_CHARS)
        details["failure"] = {"type": error_type, "message": failure_message}
        child["summary"] = failure_message
    child["id"] = _child_id(tool_name, str(child.get("title") or ""), str(child.get("summary") or ""))
    details["children"] = [child]
    if summary_parts:
        details["work_summary"] = _truncate_text("; ".join(summary_parts), _MAX_SUMMARY_CHARS)
    return details


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
    result: Any = None,
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
    details = _tool_evidence(
        tool_name,
        safe_args,
        result=result,
        observer_status=observer_status,
        phase=phase,
        duration_ms=duration_ms,
        error_type=error_type,
        error_message=error_message,
    )
    summary = details.get("work_summary") or summary
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

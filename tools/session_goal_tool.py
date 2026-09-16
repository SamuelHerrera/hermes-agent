"""Manage the current Desktop chat's standing goal without UI automation."""

import json
from dataclasses import asdict

from gateway.session_context import get_session_env
from tools import desktop_ui
from tools.registry import registry, tool_error


def session_goal(action="status", text=None, max_turns=None, *, notify=True):
    from hermes_cli.config import load_config
    from hermes_cli.goals import DEFAULT_MAX_TURNS, GoalManager, load_goal

    sid = get_session_env("HERMES_SESSION_ID", "")
    if not sid:
        return tool_error("No current session is bound; no goal was changed.")
    if action not in {"set", "status", "pause", "resume", "clear"}:
        return tool_error("action must be set, status, pause, resume, or clear")
    if action == "set" and (not isinstance(text, str) or not text.strip()):
        return tool_error("text is required for set")
    if max_turns is not None and (type(max_turns) is not int or max_turns < 1):
        return tool_error("max_turns must be a positive integer")

    try:
        config = load_config()
        budget = int((config.get("goals") or {}).get("max_turns") or DEFAULT_MAX_TURNS)
        mgr = GoalManager(sid, default_max_turns=budget)
        if action == "set":
            mgr.set(text, max_turns=max_turns)
        elif action == "pause":
            mgr.pause(reason="agent-paused")
        elif action == "resume":
            mgr.resume()
        elif action == "clear":
            mgr.clear()

        # GoalManager is best-effort for legacy callers. A tool must not claim
        # success when the persistent write failed.
        persisted = load_goal(sid)
        if action != "status":
            if mgr.state is not None:
                if persisted != mgr.state:
                    return tool_error("Goal update could not be persisted.")
            elif persisted is not None and persisted.status != "cleared":
                return tool_error("Goal clear could not be persisted.")
        status = mgr.status_line()
        result = {
            "success": True,
            "session_id": sid,
            "state": asdict(mgr.state) if mgr.state is not None else None,
            "status_text": status,
        }
    except Exception as exc:
        return tool_error(f"Could not update the session goal: {exc}")

    # The existing status channel updates every client's goal indicator.
    # Rendering failure must not misreport a successful durable write.
    try:
        if notify:
            desktop_ui.emit("status.update", {"kind": "goal", "text": status})
    except Exception:
        pass
    return json.dumps(result, ensure_ascii=False)


registry.register(
    name="session_goal",
    toolset="desktop_ui",
    schema={
        "name": "session_goal",
        "description": (
            "Set or inspect the current chat's persistent standing goal. Use set "
            "when the user asks you to establish a goal; no UI interaction or "
            "Kanban task is needed. The existing goal loop evaluates progress "
            "after this turn and continues until done, paused, or its turn budget "
            "is exhausted. Set replaces the previous goal. Does not grant extra "
            "permissions or remove approval requirements. Use pause, resume, or "
            "clear only when requested. Targets this session only."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["set", "status", "pause", "resume", "clear"]},
                "text": {"type": "string", "description": "Standing goal text, required for set."},
                "max_turns": {"type": "integer", "minimum": 1, "description": "Optional turn budget for set; otherwise uses goals.max_turns."},
            },
            "required": ["action"],
        },
    },
    handler=lambda args, **kw: session_goal(
        action=args.get("action", "status"), text=args.get("text"), max_turns=args.get("max_turns")
    ),
)

"""Explicit Desktop MCP reload requests, applied at the turn boundary."""

import json

from tools.registry import registry, tool_error

_request_reload = None


def set_mcp_reload_callback(callback):
    global _request_reload
    _request_reload = callback


def reload_mcp(confirm=False):
    if confirm is not True:
        return json.dumps({
            "status": "confirm_required",
            "message": "Reload reconnects MCP servers and invalidates this chat's prompt cache. Ask the user before calling with confirm=true.",
        })
    if _request_reload is None:
        return tool_error("A live Desktop chat is required; no MCP servers were reloaded.")
    try:
        return json.dumps(_request_reload())
    except Exception as exc:
        return tool_error(f"Could not request MCP reload: {exc}")


registry.register(
    name="reload_mcp",
    toolset="desktop_ui",
    schema={
        "name": "reload_mcp",
        "description": (
            "Request an MCP server/tool reload for this Desktop chat, only when the user asks. "
            "Reconnects this backend's MCP integrations and invalidates this chat's prompt cache. "
            "Requires confirm=true after user consent. Queued until this turn finishes: do not "
            "claim completion or attempt to use new tools in this turn. Completion/failure is "
            "reported in session status; new tools are available on the next turn after success. "
            "Does not restart Desktop or Chrome and does not change saved approval preferences."
        ),
        "parameters": {
            "type": "object", "additionalProperties": False,
            "properties": {"confirm": {"type": "boolean", "default": False}},
        },
    },
    handler=lambda args, **kw: reload_mcp(confirm=args.get("confirm", False)),
)

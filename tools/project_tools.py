#!/usr/bin/env python3
"""Project tools — the agent's INTENTIONAL handle on first-class Projects.

Projects (per-profile ``projects.db``) are the named workspaces the desktop
sidebar groups sessions into. Creating / switching a project is a deliberate act
expressed as explicit tools — never a side effect of a terminal ``cd``.

Exposed only on GUI sessions: the tools live in the `project` toolset (kept off
``_HERMES_CORE_TOOLS``) which the desktop/TUI gateway folds into its resolved
toolsets, so no CLI/messaging/cron schema carries them. The GUI also wires
``set_project_workspace_callback`` so a create/switch re-anchors the live
session's cwd and the sidebar follows the move; the DB write is the durable part.
"""

import json
import os
from typing import Callable, Optional

from tools.registry import registry

# Set by the GUI gateway (tui_gateway) at session wiring. Receives
# ``(task_id, primary_path, project_name)`` and re-anchors that session's
# workspace + refreshes the sidebar. ``None`` in CLI / messaging contexts — the
# DB write still happens; there's just no live GUI session to move.
_workspace_callback: Optional[Callable[[str, str, str], None]] = None
_spawn_callback: Optional[Callable[[str, dict], dict]] = None


def set_session_spawn_callback(fn) -> None:
    global _spawn_callback
    _spawn_callback = fn


def session_spawn(project: str, prompt: str, title: str = "", idempotency_key=None,
                  open_tab: bool = False, task_id: Optional[str] = None) -> str:
    if not _spawn_callback or not task_id:
        return json.dumps({"success": False, "status": "unavailable", "error": "A connected Hermes Desktop session is required."})
    return json.dumps(_spawn_callback(task_id, {
        "project": project, "prompt": prompt, "title": title,
        "idempotency_key": idempotency_key, "open_tab": open_tab,
    }))


def set_project_workspace_callback(fn: Optional[Callable[[str, str, str], None]]) -> None:
    global _workspace_callback
    _workspace_callback = fn


def _primary_path(proj) -> Optional[str]:
    if getattr(proj, "primary_path", None):
        return proj.primary_path
    for folder in proj.folders:
        if folder.is_primary:
            return folder.path
    return proj.folders[0].path if proj.folders else None


def _apply_workspace(task_id: Optional[str], path: Optional[str], name: str) -> None:
    cb = _workspace_callback
    if cb and task_id and path:
        try:
            cb(task_id, path, name)
        except Exception:
            pass


def _resolve(conn, token: str):
    from hermes_cli import projects_db as pdb

    token = (token or "").strip()
    if not token:
        return None
    projects = pdb.list_projects(conn, include_archived=True)
    # Exact id / slug / name first, then case-insensitive slug / name.
    for proj in projects:
        if token in (proj.id, proj.slug) or proj.name == token:
            return proj
    low = token.lower()
    for proj in projects:
        if proj.slug.lower() == low or proj.name.lower() == low:
            return proj
    return None


def project_list(task_id: Optional[str] = None) -> str:
    from hermes_cli import projects_db as pdb

    with pdb.connect_closing() as conn:
        active = pdb.get_active_id(conn)
        projects = pdb.list_projects(conn)

    return json.dumps({
        "active_id": active,
        "projects": [
            {
                "id": p.id,
                "slug": p.slug,
                "name": p.name,
                "primary_path": _primary_path(p),
                "active": p.id == active,
            }
            for p in projects
        ],
    })


def project_create(name: str, path: Optional[str] = None, task_id: Optional[str] = None) -> str:
    name = (name or "").strip()
    if not name:
        return json.dumps({"success": False, "error": "name is required"})

    from hermes_cli import projects_db as pdb

    folder = (path or "").strip()
    if folder:
        folder = os.path.abspath(os.path.expanduser(folder))

    try:
        with pdb.connect_closing() as conn:
            pid = pdb.create_project(conn, name=name, folders=[folder] if folder else [], primary_path=folder or None)
            pdb.set_active(conn, pid)
            proj = pdb.get_project(conn, pid)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)})

    if proj is None:
        return json.dumps({"success": False, "error": "project vanished after create"})

    primary = _primary_path(proj)
    _apply_workspace(task_id, primary, proj.name)

    return json.dumps({"success": True, "id": proj.id, "slug": proj.slug, "name": proj.name, "primary_path": primary})


def project_switch(project: str, task_id: Optional[str] = None) -> str:
    from hermes_cli import projects_db as pdb

    with pdb.connect_closing() as conn:
        proj = _resolve(conn, project)
        if proj is None:
            return json.dumps({"success": False, "error": f"no project matching '{project}'"})
        pdb.set_active(conn, proj.id)

    primary = _primary_path(proj)
    _apply_workspace(task_id, primary, proj.name)

    return json.dumps({"success": True, "id": proj.id, "slug": proj.slug, "name": proj.name, "primary_path": primary})


registry.register(
    name="project_list",
    toolset="project",
    schema={
        "name": "project_list",
        "description": "List the desktop Projects (named workspaces) and which one is active.",
        "parameters": {"type": "object", "properties": {}},
    },
    handler=lambda args, **kw: project_list(task_id=kw.get("task_id")),
)

registry.register(
    name="project_create",
    toolset="project",
    schema={
        "name": "project_create",
        "description": (
            "Create a desktop Project (a named workspace) and switch this chat into it. "
            "Pass `path` to anchor it to a repo/folder — this chat's workspace moves there "
            "and the sidebar follows. Use when starting work in a new repo/folder; this is "
            "the intentional way to move the session, not `cd`."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Human name, e.g. 'Aurora Demo'"},
                "path": {"type": "string", "description": "Primary repo/folder to anchor the project to"},
            },
            "required": ["name"],
        },
    },
    handler=lambda args, **kw: project_create(
        name=args.get("name", ""), path=args.get("path"), task_id=kw.get("task_id")
    ),
)

registry.register(
    name="project_switch",
    toolset="project",
    schema={
        "name": "project_switch",
        "description": (
            "Switch this chat into an existing desktop Project (by name, slug, or id). "
            "Moves the session's workspace to the project's primary folder and the sidebar "
            "follows. The intentional way to move between projects, not `cd`."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "project": {"type": "string", "description": "Project name, slug, or id"},
            },
            "required": ["project"],
        },
    },
    handler=lambda args, **kw: project_switch(project=args.get("project", ""), task_id=kw.get("task_id")),
)

registry.register(
    name="session_spawn",
    toolset="project",
    schema={
        "name": "session_spawn",
        "description": (
            "Start an independent, durable top-level chat in an existing Hermes Desktop project. "
            "Does not move this chat or create a child task. Send a self-contained prompt; no "
            "conversation history or caller overrides are copied. Returns immediately after "
            "initial-turn acceptance, with a clickable @session link. Project accepts ID, slug, "
            "or unambiguous name in this Desktop backend/profile; use Hermes-profile::project "
            "for another configured backend/profile (not a Chrome profile). Reuse an "
            "idempotency_key after timeouts. If omitted, identical handoffs deduplicate; use "
            "a new key only for intentionally separate work. Inspect partial-failure status "
            "and the returned session before manually resubmitting."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "project": {"type": "string", "description": "Existing project ID, slug or name; optionally Hermes-profile::project"},
                "prompt": {"type": "string", "description": "Only this self-contained prompt is handed off"},
                "title": {"type": "string", "description": "Optional initial chat title"},
                "idempotency_key": {"type": "string", "description": "Stable unique key for retries of this handoff"},
                "open_tab": {"type": "boolean", "description": "Add a background tab without changing focus; default false"},
            },
            "required": ["project", "prompt"],
        },
    },
    handler=lambda args, **kw: session_spawn(
        project=args.get("project", ""), prompt=args.get("prompt", ""),
        title=args.get("title", ""), idempotency_key=args.get("idempotency_key"),
        open_tab=args.get("open_tab", False), task_id=kw.get("task_id"),
    ),
)

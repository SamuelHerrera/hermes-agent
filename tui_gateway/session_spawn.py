"""Durable, independent project-chat handoff over the normal gateway lifecycle.

The renderer selects the authenticated backend; this module only resolves projects
in that backend/profile. It never runs a CLI or inserts session/message rows itself.
"""
from __future__ import annotations

import hashlib
import json
import os

from hermes_cli import projects_db as pdb
from hermes_cli.sqlite_util import write_txn
from hermes_constants import reset_hermes_home_override, set_hermes_home_override


def resolve_project(conn, token: str):
    projects = pdb.list_projects(conn)
    # IDs are canonical. All name/slug matches must be unambiguous, including
    # a name colliding with another project's slug.
    exact = [p for p in projects if p.id == token]
    matches = exact or [p for p in projects if token.casefold() in (p.slug.casefold(), p.name.casefold())]
    if len(matches) != 1:
        raise ValueError("ambiguous project; use its ID" if matches else "unknown project")
    return matches[0]


def spawn(server, params: dict) -> dict:
    project = params.get("project")
    prompt = params.get("prompt")
    key = params.get("idempotency_key")
    title = params.get("title", "")
    if not isinstance(project, str) or not project.strip():
        raise ValueError("project is required")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("prompt is required")
    if not isinstance(title, str):
        raise ValueError("title must be a string")
    if key is not None and (not isinstance(key, str) or not key.strip() or len(key) > 256):
        raise ValueError("idempotency_key must be a nonempty string of at most 256 characters")
    profile = params.get("profile")
    if profile is not None and not isinstance(profile, str):
        raise ValueError("profile must be a Hermes profile name")
    home = server._profile_home(profile)
    if profile and home is None and profile != server._response_profile_name(None):
        raise ValueError("unknown Hermes profile on this backend")
    token = set_hermes_home_override(home or server._hermes_home)
    try:
        return _spawn_scoped(server, project.strip(), prompt, title.strip(), key, profile)
    finally:
        reset_hermes_home_override(token)


def _spawn_scoped(server, target, prompt, title, key, profile):
    with pdb.connect_closing() as conn:
        project = resolve_project(conn, target)
        cwd = project.primary_path or next((f.path for f in project.folders if f.is_primary), None)
        if not cwd or not os.path.isdir(cwd):
            raise ValueError("project has no existing primary working directory on this backend")
        # Match the normal sidebar's canonical folder ownership. Refuse rather
        # than start in the wrong project when overlapping folder definitions win.
        from tui_gateway.project_tree import _FolderIndex, _project_for_session
        owner = _project_for_session({"cwd": cwd}, _FolderIndex([p.to_dict() for p in pdb.list_projects(conn)]), None)
        if not owner or owner["id"] != project.id:
            raise ValueError("project primary directory belongs to another sidebar project")
        fingerprint = hashlib.sha256(json.dumps([project.id, prompt, title], ensure_ascii=False).encode()).hexdigest()
        # An omitted key deliberately deduplicates identical handoffs. A caller
        # wanting a second identical task must supply a new explicit key.
        key = key or "auto:" + fingerprint
        result = {
            "success": False, "status": "creating", "idempotency_key": key,
            "project": project.to_dict(), "profile": server._response_profile_name(profile),
            "cwd": cwd, "session_id": None, "runtime_session_id": None, "link": None,
        }
        with write_txn(conn):
            previous = conn.execute("SELECT fingerprint, result FROM session_spawns WHERE request_key = ?", (key,)).fetchone()
            if previous:
                if previous["fingerprint"] != fingerprint:
                    raise ValueError("idempotency_key already belongs to a different handoff")
                replay = json.loads(previous["result"])
                replay["replayed"] = True
                return replay
            conn.execute(
                "INSERT INTO session_spawns (request_key, fingerprint, project_id, result) VALUES (?, ?, ?, ?)",
                (key, fingerprint, project.id, json.dumps(result)),
            )

        def save():
            with write_txn(conn):
                conn.execute("UPDATE session_spawns SET session_id = ?, result = ? WHERE request_key = ?", (result["session_id"], json.dumps(result), key))

        try:
            created = server._methods["session.create"]("spawn-create", {
                "cwd": cwd, "source": "desktop", "title": title, "profile": profile,
                "close_on_disconnect": False,
            })
            if created.get("error"):
                raise RuntimeError(created["error"]["message"])
            data = created["result"]
            sid, stored = data["session_id"], data["stored_session_id"]
            result.update(session_id=stored, runtime_session_id=sid, link=f"@session:{result['profile']}/{stored}")
            save()  # reserve the identity before any durable session write
            session = server._sessions[sid]
            server._ensure_session_db_row(session)
            with server._session_db(session) as db:
                if db is None or db.get_session(stored) is None:
                    raise RuntimeError("session persistence unavailable; initial turn was not submitted")
                db.update_session_cwd(stored, cwd, server._git_branch_for_cwd(cwd), server._git_common_repo_root_for_cwd(cwd))
                if title:
                    db.set_session_title(stored, title)
            result["status"] = "starting"
            save()  # crash from this point is ambiguous: retries MUST NOT submit
            server._broadcast_global_event("sessions.changed", {"spawn": result.copy()})
            submitted = server._methods["prompt.submit"]("spawn-submit", {"session_id": sid, "text": prompt})
            if submitted.get("error"):
                result.update(status="start_failed", error=submitted["error"]["message"])
            elif submitted.get("result", {}).get("status") != "streaming":
                result.update(status="start_failed", error="initial prompt was not accepted for execution")
            else:
                result.update(success=True, status="started")
        except Exception as exc:
            result.update(status="start_unknown" if result["status"] == "starting" else "creation_failed", error=str(exc))
        if not result["success"]:
            result["recovery"] = "Open the returned session link and inspect its transcript/live state before submitting anything. Reuse this idempotency_key to look up the original handoff; never use a new key to retry an uncertain start."
        try:
            save()
        except Exception as exc:
            # Never lose the usable session handle merely because writing the
            # final receipt failed. The pre-submit reservation still prevents a
            # duplicate; a retry may truthfully report an uncertain start.
            result["receipt_error"] = str(exc)
        server._broadcast_global_event("sessions.changed", {"spawn": result.copy()})
        return result

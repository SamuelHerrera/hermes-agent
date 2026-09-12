"""Explicit archive cleanup. Archiving is distinct from detaching a chat tab."""

from pathlib import Path


def archive_family_ids(db, session_id: str) -> set[str]:
    """Compression lineages and recursively owned delegates, never user forks."""
    found: set[str] = set()
    pending = [session_id]
    while pending:
        current = pending.pop()
        if current in found:
            continue
        found.add(current)
        pending.extend(set(db.get_compression_lineage(current)) - found)
        pending.extend(set(db.get_session_delete_targets(current)) - found)
    return found


def stop_archived_session_work(db, session_id: str) -> dict:
    """Stop only this durable chat family; preserve transcripts for unarchive."""
    from agent.interrupt_compat import request_hard_interrupt
    from tools.async_delegation import interrupt_for_session
    from tools.process_registry import process_registry
    from tui_gateway import server

    family = archive_family_ids(db, session_id)
    home = Path(db.db_path).parent.resolve()
    process_ids = []
    with server._sessions_lock:
        live = [
            (sid, session) for sid, session in server._sessions.items()
            if Path(session.get("profile_home") or server._hermes_home).resolve() == home
            and (session.get("session_key") in family or server._session_lookup_key(session) in family)
        ]
    # Stop producers before taking the process snapshot, so a live turn cannot
    # simply replace the server we just killed. Use the existing hard-stop gate.
    for sid, session in live:
        with session["history_lock"]:
            session["_turn_cancel_requested"] = True
            session["queued_prompt"] = None
            session.pop("queued_prompts", None)
            session["_queued_prompt_generation"] = int(session.get("_queued_prompt_generation", 0)) + 1
        if (session.get("_compute_host_active") or session.get("running")) and server._session_uses_compute_host(session):
            response = server._get_compute_host_supervisor().control(
                sid, route_name="session.archive", payload={"session_id": session_id},
            )
            if response.get("type") != "control.ack":
                raise RuntimeError(response.get("message") or "Compute-host archive cleanup failed")
            process_ids.extend(response.get("result", {}).get("process_ids", []))
        elif session.get("agent") is not None:
            request_hard_interrupt(session["agent"])
        server._clear_pending_for_session_record(sid, session)
        interrupt_for_session(origin_ui_session_id=sid, reason="session.archive", profile_home=str(home))
    for key in family:
        interrupt_for_session(parent_session_id=key, reason="session.archive", profile_home=str(home))
    # A just-interrupted delegate may have published its durable row while the
    # initial family was being read. Include it in the final cleanup snapshot.
    family |= archive_family_ids(db, session_id)
    for entry in process_registry.list_sessions():
        proc = process_registry.get(entry["session_id"])
        if (proc is None or Path(proc.profile_home).resolve() != home
                or not ({proc.session_key, proc.parent_session_id} & family)):
            continue
        result = process_registry.kill_process(proc.id, source="session.archive", consume_output=True)
        if result.get("status") not in {"killed", "already_exited", "not_found"}:
            raise RuntimeError(f"Could not stop archived session process {proc.id}: {result.get('error', 'unknown error')}")
        process_ids.append(proc.id)
    return {"session_ids": sorted(family | {sid for sid, _ in live}), "process_ids": process_ids}

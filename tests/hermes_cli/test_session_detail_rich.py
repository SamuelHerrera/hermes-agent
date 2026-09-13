"""The detail API must not downgrade preview-based child titles."""
import asyncio

from hermes_state import SessionDB
from hermes_cli.web_routers import sessions


def test_detail_preserves_rich_child_metadata(tmp_path, monkeypatch):
    path = tmp_path / "state.db"
    db = SessionDB(path)
    db.create_session("parent", source="desktop")
    db.create_session("child", source="desktop", model_config={"_delegate_from": "parent"})
    db.append_message("child", role="user", content="Investigate session titles")
    expected = db.get_session_rich_row("child", compact_rows=True)
    db.close()
    monkeypatch.setattr(sessions, "_open_session_db_for_profile", lambda *a, **kw: SessionDB(path, read_only=True))
    monkeypatch.setattr(sessions, "_cron_default_profile", lambda: "default")
    result = asyncio.run(sessions.get_session_detail("child"))
    assert result["preview"] == expected["preview"]
    assert result["delegate_parent_session_id"] == "parent"
    assert result["last_active"] == expected["last_active"]
    assert result["profile"] == "default"

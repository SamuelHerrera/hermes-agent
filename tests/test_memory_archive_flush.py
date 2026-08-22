import pytest

from agent.memory_manager import MemoryManager, flush_session_archive
from agent.memory_provider import MemoryProvider
from hermes_cli.web_models import SessionRename
from hermes_cli.web_routers import sessions


class _ArchiveProvider(MemoryProvider):
    @property
    def name(self):
        return "archive-test"

    def __init__(self):
        self.archives = []

    def initialize(self, session_id: str, **kwargs) -> None:
        self.session_id = session_id

    def is_available(self) -> bool:
        return True

    def get_tool_schemas(self):
        return []

    def on_session_archive(self, session_id: str = "", *, wait: bool = False, timeout: float = 10.0, **kwargs) -> bool:
        self.archives.append({"session_id": session_id, "wait": wait, "timeout": timeout})
        return True


class _FakeDb:
    def __init__(self):
        self.calls = []

    def resolve_session_id(self, session_id):
        self.calls.append(("resolve", session_id))
        return "resolved-session"

    def set_session_title(self, sid, title):
        self.calls.append(("title", sid, title))

    def set_session_archived(self, sid, archived):
        self.calls.append(("archive", sid, archived))

    def set_session_pinned(self, sid, pinned):
        self.calls.append(("pin", sid, pinned))

    def get_session_title(self, sid):
        self.calls.append(("get_title", sid))
        return ""

    def close(self):
        self.calls.append(("close",))


@pytest.fixture(autouse=True)
def _clear_registry():
    # Isolate the process-global archive registry between tests.
    yield
    flush_session_archive("resolved-session", wait=False)


def test_memory_manager_registers_session_for_archive_flush():
    provider = _ArchiveProvider()
    manager = MemoryManager()
    manager.add_provider(provider)
    manager.initialize_all("session-a")
    try:
        assert flush_session_archive("session-a", wait=True, timeout=1.5) is True
        assert provider.archives == [
            {"session_id": "session-a", "wait": True, "timeout": 1.5}
        ]
    finally:
        manager.shutdown_all()


@pytest.mark.asyncio
async def test_session_archive_endpoint_flushes_memory_before_hiding(monkeypatch):
    db = _FakeDb()
    events = []

    monkeypatch.setattr(sessions, "_open_session_db_for_profile", lambda profile, read_only=False: db)
    monkeypatch.setattr(
        sessions,
        "flush_session_archive",
        lambda sid, wait=True, timeout=10.0: events.append(("flush", sid, wait, timeout)) or True,
        raising=False,
    )

    result = await sessions.rename_session_endpoint(
        "session-prefix",
        SessionRename(archived=True),
    )

    assert result["archived"] is True
    assert events == [("flush", "resolved-session", True, 10.0)]
    assert db.calls.index(("archive", "resolved-session", True)) > -1

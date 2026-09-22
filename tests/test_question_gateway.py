"""Real gateway dispatch + persisted questions, without an inference provider."""
import threading
from types import SimpleNamespace

import pytest

from tools.question_inbox import QuestionInbox
from tui_gateway import server


@pytest.fixture
def gateway(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "_sessions", {})
    monkeypatch.setattr(server, "_pending", {})
    monkeypatch.setattr(server, "_pending_prompt_payloads", {})
    monkeypatch.setattr(server, "_answers", {})
    monkeypatch.setattr(server, "current_transport", lambda: None)
    monkeypatch.setattr("hermes_cli.config.load_config", lambda: {"agent": {"clarify_soft_timeout": 0}})
    monkeypatch.setattr(server, "_emit", lambda *args: None)
    server._sessions["runtime"] = {"session_key": "durable", "profile_home": str(tmp_path),
                                   "agent": SimpleNamespace(session_id="durable"),
                                   "history_lock": threading.RLock(), "running": True}
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    return server


def test_live_answer_is_persisted_before_releasing_waiter(gateway, monkeypatch):
    emitted = threading.Event()
    payloads = []
    def emit(kind, sid, payload):
        if kind == "clarify.request":
            payloads.append(payload)
            emitted.set()
    monkeypatch.setattr(gateway, "_emit", emit)
    result = []
    worker = threading.Thread(target=lambda: result.append(gateway._block(
        "clarify.request", "runtime", {"question": "Format?", "choices": ["CSV", "JSON"]}, None)))
    worker.start()
    assert emitted.wait(5)
    request_id = payloads[0]["request_id"]
    reply = gateway._methods["clarify.respond"](1, {"request_id": request_id, "answer": "CSV"})
    worker.join(5)
    assert not worker.is_alive()
    assert reply["result"]["status"] == "ok"
    assert result[0]["user_response"] == "CSV"
    assert QuestionInbox().get(request_id)["answered_by"] == "user"


def test_late_inbox_answer_queues_once_without_interrupt(gateway, monkeypatch):
    row = QuestionInbox().create(session_id="durable", runtime_id="old-runtime",
                                 question="Format?", choices=["CSV", "JSON"])
    monkeypatch.setitem(gateway._methods, "session.resume", lambda rid, params: {
        "result": {"session_id": "runtime"}})
    first = gateway._methods["questions.respond"](1, {"question_id": row["id"], "answer": "CSV"})
    assert first["result"]["status"] == "queued"
    assert "CSV" in gateway._sessions["runtime"]["queued_prompt"]["text"]
    second = gateway._methods["questions.respond"](2, {"question_id": row["id"], "answer": "JSON"})
    assert second["result"]["status"] == "already_resolved"
    assert not gateway._sessions["runtime"].get("queued_prompts")


def test_live_inbox_answer_does_not_deadlock(gateway, monkeypatch):
    store = QuestionInbox()
    row = store.create(session_id="durable", runtime_id="runtime", question="Format?", choices=["CSV"])
    event = threading.Event()
    gateway._pending[row["id"]] = ("runtime", event)
    monkeypatch.setitem(gateway._methods, "session.resume", lambda rid, params: {
        "result": {"session_id": "runtime"}})
    reply = gateway._methods["questions.respond"](1, {"question_id": row["id"], "answer": "CSV"})
    assert reply["result"]["status"] == "ok"
    assert event.is_set()
    assert store.get(row["id"])["answer"] == "CSV"


def test_question_list_does_not_leak_other_profile(gateway, monkeypatch, tmp_path):
    QuestionInbox(tmp_path / "other").create(session_id="other-session", runtime_id="other",
                                            question="Private?", choices=None)
    assert gateway._methods["questions.list"](1, {})["result"]["questions"] == []


def test_failed_resume_keeps_question_open(gateway, monkeypatch):
    row = QuestionInbox().create(session_id="gone", runtime_id="old", question="Format?", choices=["CSV"])
    monkeypatch.setitem(gateway._methods, "session.resume", lambda rid, params: {"error": {"message": "Unavailable"}})
    result = gateway._methods["questions.respond"](1, {"question_id": row["id"], "answer": "CSV"})
    assert "error" in result
    assert QuestionInbox().get(row["id"])["status"] == "open"


def test_discard_closes_question_without_resuming_session(gateway, monkeypatch):
    store = QuestionInbox()
    row = store.create(session_id="durable", runtime_id="old", question="Still needed?", choices=None)
    resumed = []
    monkeypatch.setitem(gateway._methods, "session.resume", lambda rid, params: resumed.append(params))

    result = gateway._methods["questions.dismiss"](1, {"question_id": row["id"]})

    assert result["result"]["status"] == "dismissed"
    assert resumed == []
    assert store.get(row["id"])["status"] == "dismissed"
    assert store.count_open() == 0


def test_queued_answer_can_be_recovered_after_backend_restart(gateway, monkeypatch):
    from tui_gateway.questions import acknowledge_deliveries
    store = QuestionInbox()
    row = store.create(session_id="durable", runtime_id="old-runtime", question="Format?", choices=["CSV"])
    monkeypatch.setitem(gateway._methods, "session.resume", lambda rid, params: {"result": {"session_id": "runtime"}})
    params = {"question_id": row["id"], "answer": "CSV"}
    assert gateway._methods["questions.respond"](1, params)["result"]["status"] == "queued"
    assert store.get(row["id"])["delivery_pending"] is True
    session = gateway._sessions["runtime"]
    session.pop("queued_prompt")
    session.pop("question_deliveries")  # Restart loses the old in-memory queue.
    assert gateway._methods["questions.respond"](2, params)["result"]["status"] == "queued"
    assert row["id"] in session["queued_prompt"]["text"]
    acknowledge_deliveries(session, session["queued_prompt"]["text"])
    assert store.get(row["id"])["delivery_pending"] is False
    assert gateway._methods["questions.respond"](3, params)["result"]["status"] == "already_resolved"


def test_idle_answer_uses_explicit_queue_semantics(gateway, monkeypatch):
    store = QuestionInbox()
    row = store.create(session_id="durable", runtime_id="old", question="Format?", choices=["CSV"])
    gateway._sessions["runtime"]["running"] = False
    monkeypatch.setitem(gateway._methods, "session.resume", lambda rid, params: {"result": {"session_id": "runtime"}})
    calls = []
    monkeypatch.setitem(gateway._methods, "prompt.submit", lambda rid, params: calls.append(params) or {"result": {"status": "queued"}})
    gateway._methods["questions.respond"](1, {"question_id": row["id"], "answer": "CSV"})
    assert calls[0]["queued"] is True


def test_notification_count_is_not_limited_by_the_visible_page(gateway):
    store = QuestionInbox()
    rows = [store.create(session_id="durable", runtime_id="runtime", question=f"Question {i}", choices=None) for i in range(3)]
    store.answer(rows[0]["id"], "done", actor="user")
    result = gateway._methods["questions.list"](1, {"limit": 1})["result"]
    assert len(result["questions"]) == 1
    assert result["open_count"] == 2
    store.answer(rows[1]["id"], "saved", actor="user", delivery_pending=True)
    result = gateway._methods["questions.list"](2, {"limit": 1, "offset": 1})["result"]
    assert result["open_count"] == 2  # Interrupted deliveries still need attention.

"""Question lifecycle contracts, using a real profile-scoped SQLite store."""
import threading


def test_questions_default_to_no_expiry():
    from tools.clarify_gateway import resolve_clarify_timeout
    from hermes_cli.config import DEFAULT_CONFIG

    assert resolve_clarify_timeout({}) <= 0
    assert resolve_clarify_timeout(DEFAULT_CONFIG) <= 0


def test_unanswered_questions_survive_reopen_and_resolve_once(tmp_path):
    from tools.question_inbox import QuestionInbox

    store = QuestionInbox(tmp_path)
    q = store.create(session_id="durable", runtime_id="runtime", question="Format?",
                     choices=["CSV", "JSON"], requires_user=False)
    reopened = QuestionInbox(tmp_path)
    assert reopened.list()[0]["id"] == q["id"]
    assert reopened.answer(q["id"], "CSV", actor="user")
    assert not store.answer(q["id"], "JSON", actor="reviewer")
    assert store.get(q["id"])["answer"] == "CSV"
    assert reopened.list() == []


def test_soft_review_releases_tool_without_closing_unanswered_question(tmp_path):
    from tui_gateway.questions import wait_for_question
    from tools.question_inbox import QuestionInbox

    result = wait_for_question(
        QuestionInbox(tmp_path), session_id="session", runtime_id="runtime",
        payload={"question": "Format?", "choices": ["CSV", "JSON"], "requires_user": False},
        event=threading.Event(), publish=lambda row: None,
        read_answer=lambda: "", timeout=None, soft_timeout=0.01, review_timeout=1,
        reviewer=lambda row: {"decision": "defer", "reason": "Evidence conflicts"},
    )
    assert result["status"] == "deferred"
    assert result["user_response"] is None
    assert QuestionInbox(tmp_path).get(result["question_id"])["status"] == "open"


def test_hard_question_never_calls_reviewer(tmp_path):
    from tui_gateway.questions import wait_for_question
    from tools.question_inbox import QuestionInbox

    def forbidden(row):
        raise AssertionError("Hard questions must not reach the model")

    result = wait_for_question(
        QuestionInbox(tmp_path), session_id="session", runtime_id="runtime",
        payload={"question": "Pay?", "choices": ["Yes", "No"]},
        event=threading.Event(), publish=lambda row: None,
        read_answer=lambda: "", timeout=None, soft_timeout=0.01, review_timeout=1,
        reviewer=forbidden,
    )
    assert result["status"] == "deferred"
    assert result["requires_user"] is True


def test_review_requires_real_quotes_from_both_sources(tmp_path):
    from agent.question_review import validate_evidence

    evidence = {"markdown": "Prefer CSV", "hindsight": "CSV for reports"}
    decision = {"decision": "answer", "safe": True, "answer": "CSV",
                "evidence": {"markdown": "Prefer CSV", "hindsight": "CSV for reports"}}
    assert validate_evidence(decision, evidence)["decision"] == "answer"
    decision["evidence"]["hindsight"] = "invented preference"
    assert validate_evidence(decision, evidence)["decision"] == "defer"


def test_clarify_preserves_automatic_actor_and_required_user_flag():
    import json
    from tools.clarify_tool import clarify_tool

    def callback(question, choices, requires_user=True):
        assert requires_user is False
        return {"status": "answered", "user_response": None, "automatic_response": "CSV",
                "answered_by": "reviewer"}

    result = json.loads(clarify_tool("Format?", ["CSV", "JSON"], callback=callback,
                                   requires_user=False))
    assert result["user_response"] is None
    assert result["automatic_response"] == "CSV"


def test_concurrent_answers_have_one_winner(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from tools.question_inbox import QuestionInbox
    store = QuestionInbox(tmp_path)
    row = store.create(session_id="s", runtime_id="r", question="Format?", choices=["CSV", "JSON"])
    barrier = threading.Barrier(6)
    def answer(index):
        barrier.wait(timeout=5)
        return store.answer(row["id"], str(index))
    with ThreadPoolExecutor(max_workers=6) as pool:
        assert sum(pool.map(answer, range(6))) == 1
    assert store.get(row["id"])["answered_by"] == "user"


def test_review_timeout_discards_late_answer(tmp_path):
    from tools.question_inbox import QuestionInbox
    from tui_gateway.questions import wait_for_question
    store = QuestionInbox(tmp_path)
    release, done = threading.Event(), threading.Event()
    def review(row):
        release.wait(5)
        done.set()
        return {"decision": "answer", "safe": True, "answer": "CSV",
                "evidence": {"markdown": "CSV format", "hindsight": "CSV format"}}
    result = wait_for_question(store, session_id="s", runtime_id="r",
        payload={"question": "Format?", "choices": ["CSV"], "requires_user": False},
        event=threading.Event(), publish=lambda row: None, read_answer=lambda: None,
        timeout=None, soft_timeout=.01, review_timeout=.01, reviewer=review)
    release.set()
    assert done.wait(5)
    assert result["status"] == "deferred"
    assert store.get(result["question_id"])["status"] == "open"


def test_cancellation_keeps_the_question_open(tmp_path):
    from tools.question_inbox import QuestionInbox
    from tui_gateway.questions import wait_for_question
    event = threading.Event()
    event.set()
    store = QuestionInbox(tmp_path)
    result = wait_for_question(store, session_id="s", runtime_id="r",
        payload={"question": "Format?", "choices": ["CSV"]}, event=event,
        publish=lambda row: None, read_answer=lambda: None,
        timeout=None, soft_timeout=0, review_timeout=1, reviewer=None)
    assert result["status"] == "deferred"
    assert len(store.list()) == 1


def test_review_reads_both_sources_and_current_session(tmp_path, monkeypatch):
    import json
    from types import SimpleNamespace
    from agent.question_review import review_question
    (tmp_path / "memories").mkdir()
    (tmp_path / "memories" / "USER.md").write_text("User prefers CSV reports.")
    calls = []
    provider = SimpleNamespace(handle_tool_call=lambda name, args: (
        calls.append(name) or json.dumps({"result": "User prefers CSV reports."})))
    manager = SimpleNamespace(get_provider=lambda name: provider if name == "hindsight" else None)
    def infer(**kwargs):
        assert kwargs["task"] == "clarify_review"
        assert "tools" not in kwargs
        context = json.loads(kwargs["messages"][1]["content"])
        assert context["session"][0]["content"] == "Make a report"
        assert context["question"]["session_id"] == "s"
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({
            "decision": "answer", "safe": True, "answer": "CSV", "reason": "Corroborated preference",
            "evidence": {"markdown": "User prefers CSV reports.", "hindsight": "User prefers CSV reports."}
        })))])
    monkeypatch.setattr("agent.auxiliary_client.call_llm", infer)
    result = review_question({"requires_user": False, "choices": ["CSV", "JSON"], "question": "Format?", "session_id": "s"},
        agent=SimpleNamespace(_memory_manager=manager), history=[{"role": "user", "content": "Make a report"}], home=tmp_path)
    assert result["answer"] == "CSV"
    assert calls == ["hindsight_recall"]


def test_question_search_is_not_limited_to_first_page(tmp_path):
    from tools.question_inbox import QuestionInbox
    store = QuestionInbox(tmp_path)
    for question in ["First?", "Second?", "Third?"]:
        store.create(session_id="s", runtime_id="r", question=question, choices=None)
    assert store.list(limit=1, query="third")[0]["question"] == "Third?"
    assert store.list(limit=1, offset=2)[0]["question"] == "Third?"

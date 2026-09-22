"""Desktop/TUI clarification lifecycle, separate from security approvals."""
from __future__ import annotations

import contextvars
import queue
import threading
import time

from tools.question_inbox import QuestionInbox, valid_review

# Hung network calls cannot accumulate an unbounded number of reviewer threads.
_review_slots = threading.BoundedSemaphore(2)


def _result(row: dict) -> dict:
    from tools.clarify_tool import strip_recommended
    answered = row["status"] == "answered"
    dismissed = row["status"] == "dismissed"
    value = row["answer"]
    if value is not None:
        value = [strip_recommended(v) for v in value] if isinstance(value, list) else strip_recommended(value)
    return {
        "question_id": row["id"], "question": row["question"],
        "choices_offered": row["choices"], "requires_user": row["requires_user"],
        "status": "answered" if answered else "dismissed" if dismissed else "deferred",
        "user_response": value if answered and row["answered_by"] == "user" else None,
        "automatic_response": value if answered and row["answered_by"] == "reviewer" else None,
        "answered_by": row["answered_by"], "review": row["review"],
        "instruction": (
            "Continue the authorized task using this answer. An automatic response is NOT user consent."
            if answered else
            "The user dismissed this question without answering it. Do not resume or repeat the question. "
            "Continue only work that does not depend on the missing answer."
            if dismissed else
            "The question remains open in the Questions inbox. Do not ask it again. "
            "Continue independent, reversible work within the existing user authorization. "
            "Do not guess this answer or take any action depending on it. If all remaining "
            "work depends on the answer, report the blocker and end the turn; the user can resume later."
        ),
    }


def wait_for_question(store: QuestionInbox, *, session_id: str, runtime_id: str,
                      payload: dict, event: threading.Event, publish, read_answer,
                      timeout: float | None, soft_timeout: float,
                      review_timeout: float, reviewer) -> dict:
    row = store.create(session_id=session_id, runtime_id=runtime_id,
                       question=payload["question"], choices=payload.get("choices"),
                       multi_select=payload.get("multi_select", False),
                       requires_user=payload.get("requires_user", True),
                       request_id=payload.get("request_id"))
    publish(row)
    started = time.monotonic()
    review_started = None
    results = queue.Queue(maxsize=1)
    try:
        from tools.environments.base import touch_activity_if_due
    except ImportError:
        touch_activity_if_due = lambda *args: None
    activity = {"start": started, "last_touch": started}

    def run_review():
        try:
            results.put(reviewer(row))
        except Exception:
            results.put({"decision": "defer", "reason": "Review unavailable; user answer required."})
        finally:
            _review_slots.release()

    while True:
        current = store.get(row["id"])
        if current["status"] in {"answered", "dismissed"}:
            return _result(current)
        if event.is_set():
            answer = read_answer()
            if answer:
                store.answer(row["id"], answer, actor="user")
            return _result(store.get(row["id"]))
        now = time.monotonic()
        if timeout is not None and now - started >= timeout:
            return _result(current)
        if soft_timeout > 0 and now - started >= soft_timeout:
            # Hard questions are parked, never sent to the reviewer. Returning
            # a deferred result frees the loop to do unrelated authorized work.
            if current["requires_user"]:
                return _result(current)
            if review_started is None:
                if not _review_slots.acquire(blocking=False):
                    store.record_review(row["id"], {"decision": "defer", "reason": "Reviewer busy."})
                    return _result(store.get(row["id"]))
                review_started = now
                context = contextvars.copy_context()
                threading.Thread(target=context.run, args=(run_review,), daemon=True,
                                 name="clarify-review").start()
            try:
                review = results.get_nowait()
            except queue.Empty:
                review = None
            if review is not None:
                if not isinstance(review, dict):
                    review = {"decision": "defer", "reason": "Invalid review response."}
                if valid_review(current, review):
                    store.answer(row["id"], review["answer"], actor="reviewer", review=review)
                else:
                    store.record_review(row["id"], review)
                return _result(store.get(row["id"]))
            if now - review_started >= review_timeout:
                store.record_review(row["id"], {"decision": "defer", "reason": "Review timed out."})
                # Worker only returns data into a private queue. Late results
                # cannot answer the question after timeout or cancellation.
                return _result(store.get(row["id"]))
        event.wait(0.2)
        touch_activity_if_due(activity, "waiting for clarification")


def block_question(server, sid: str, payload: dict, timeout: float | None):
    from agent.question_review import review_question
    from hermes_cli.config import load_config

    session = server._sessions.get(sid) or {}
    store = QuestionInbox(session.get("profile_home"))
    cfg = (load_config() or {}).get("agent") or {}

    def seconds(key, default):
        try:
            value = float(cfg.get(key, default))
            return max(0, value) if value < float("inf") else default
        except (ValueError, TypeError):
            return default

    ev = threading.Event()
    request_id = payload.setdefault("request_id", server.uuid.uuid4().hex)
    agent = session.get("agent")
    history = list(session.get("clarify_context") or session.get("history") or [])
    durable_id = getattr(agent, "session_id", None) or session.get("session_key") or sid

    def publish(row):
        with server._prompt_lock:
            server._pending[request_id] = (sid, ev)
            server._pending_prompt_payloads[request_id] = ("clarify.request", dict(payload))
        server._emit("clarify.request", sid, dict(payload, question_id=row["id"]))

    try:
        result = wait_for_question(
            store, session_id=durable_id, runtime_id=sid, payload=payload,
            event=ev, publish=publish, read_answer=lambda: server._answers.get(request_id, ""),
            timeout=timeout, soft_timeout=seconds("clarify_soft_timeout", 120),
            review_timeout=max(1, seconds("clarify_review_timeout", 60)),
            reviewer=lambda row: review_question(row, agent=agent, history=history, home=store.home),
        )
    finally:
        with server._prompt_lock:
            # Snapshot the authoritative answer in the same critical section
            # that retires the waiter. A racing user answer either reaches this
            # tool result or takes the late-answer continuation path, not neither.
            final_row = store.get(request_id)
            if final_row is not None:
                result = _result(final_row)
            server._pending.pop(request_id, None)
            server._pending_prompt_payloads.pop(request_id, None)
            server._answers.pop(request_id, None)
        server._emit("prompt.resolved", sid, {"event": "clarify.request", "request_id": request_id})
        server._emit("questions.changed", sid, {"question_id": request_id})
    return result


def respond_question(server, rid, params):
    """An explicit inbox answer wakes its waiter or becomes a normal next turn."""
    import json

    store = QuestionInbox()
    question_id = str(params.get("question_id") or "")
    row = store.get(question_id)
    if row is None:
        return server._err(rid, 4004, "Question not found in this profile")
    if row["status"] != "open" and not row.get("delivery_pending"):
        return server._ok(rid, {"status": "already_resolved"})
    answer = row["answer"] if row["status"] == "answered" else params.get("answer")
    if not isinstance(answer, (str, list)) or not answer or (isinstance(answer, str) and not answer.strip()):
        return server._err(rid, 4002, "Answer required")
    if isinstance(answer, list) and (not row["multi_select"] or not all(
            isinstance(a, str) and a.strip() for a in answer)):
        return server._err(rid, 4002, "Invalid multi-select answer")
    # Resume uses the canonical compression-lineage resolver, profile ownership
    # and transport attachment rules. Do not recreate sessions by hand.
    resumed = server._methods["session.resume"](rid, {
        "session_id": row["session_id"], "profile": params.get("profile"),
        "omit_messages": False,
    })
    if "error" in resumed:
        return resumed  # Keep the question open, so it is safe to retry.
    sid = resumed["result"]["session_id"]
    session = server._sessions.get(sid)
    if session is None:
        return server._err(rid, 4090, "Session unavailable; question remains open")
    marker = "Answer to the saved clarification " + question_id + ":"
    if row.get("delivery_pending") and any(
        m.get("role") == "user" and marker in str(m.get("text") or m.get("content") or "")
        for m in resumed["result"].get("messages", [])
    ):
        store.acknowledge_delivery(question_id)
        return server._ok(rid, {"status": "already_resolved"})
    with server._prompt_lock:
        pending = server._pending.get(question_id)
        if pending and pending[0] == sid:
            if not store.answer(question_id, answer, actor="user"):
                return server._ok(rid, {"status": "already_resolved"})
            server._answers[question_id] = answer
            pending[1].set()
            return server._ok(rid, {"status": "ok"})
        if row["status"] == "open" and not store.answer(question_id, answer, actor="user", delivery_pending=True):
            return server._ok(rid, {"status": "already_resolved"})
    message = (marker + "\n"
               + row["question"] + "\nAnswer: " + json.dumps(answer, ensure_ascii=False)
               + "\nContinue the original task using this answer within its original scope.")
    # Queue without interrupting independent work. An idle session goes through
    # the normal submit path, with its ordinary budgets and approval gates.
    with session["history_lock"]:
        deliveries = session.setdefault("question_deliveries", set())
        if question_id in deliveries:
            return server._ok(rid, {"status": "already_resolved"})
        deliveries.add(question_id)
        running = session.get("running")
        if running:
            server._enqueue_prompt(session, message, server.current_transport())
    if not running:
        submitted = server._methods["prompt.submit"](rid, {"session_id": sid, "text": message, "queued": True})
        if "error" in submitted:
            with session["history_lock"]:
                deliveries.discard(question_id)
            return server._ok(rid, {"status": "saved", "session_id": sid,
                                    "delivery_error": submitted["error"].get("message", "Resume failed")})
    server._emit("questions.changed", sid, {"question_id": question_id})
    return server._ok(rid, {"status": "queued" if running else "resumed", "session_id": sid})


def dismiss_question(server, rid, params):
    """Close an inbox question without answering or resuming its session."""
    store = QuestionInbox()
    question_id = str(params.get("question_id") or "")
    row = store.get(question_id)
    if row is None:
        return server._err(rid, 4004, "Question not found in this profile")
    with server._prompt_lock:
        if not store.dismiss(question_id):
            return server._ok(rid, {"status": "already_resolved"})
        pending = server._pending.get(question_id)
        if pending:
            pending[1].set()
    sid = row.get("runtime_id") or row.get("session_id")
    server._emit("prompt.resolved", sid, {"event": "clarify.request", "request_id": question_id})
    server._emit("questions.changed", sid, {"question_id": question_id})
    return server._ok(rid, {"status": "dismissed"})


def acknowledge_deliveries(session, text):
    """Clear the durable outbox only once its normal user turn has executed.

    Undrained replies remain visible/retryable in the inbox across restarts.
    The transcript marker also makes a post-crash explicit retry idempotent.
    """
    with session["history_lock"]:
        deliveries = session.get("question_deliveries", set())
        received = {qid for qid in deliveries if f"Answer to the saved clarification {qid}:" in str(text)}
        if not received:
            return False
        store = QuestionInbox(session.get("profile_home"))
        for question_id in received:
            store.acknowledge_delivery(question_id)
            deliveries.discard(question_id)
        return True

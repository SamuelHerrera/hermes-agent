"""Durable clarification inbox. This is data, not an approval mechanism.

One SQLite database per Hermes home; connections are short-lived so gateway
threads and restarted processes share atomic first-answer-wins semantics.
"""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from hermes_constants import get_hermes_home


class QuestionInbox:
    def __init__(self, home: Path | str | None = None):
        self.home = Path(home) if home is not None else get_hermes_home()
        self.path = self.home / "questions.db"
        self.home.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS questions (
                id TEXT PRIMARY KEY, status TEXT NOT NULL, payload TEXT NOT NULL,
                created REAL NOT NULL)""")

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def create(self, *, session_id: str, runtime_id: str, question: str,
               choices: list | None, requires_user: bool = True,
               multi_select: bool = False, request_id: str | None = None) -> dict:
        row = dict(id=request_id or uuid.uuid4().hex, session_id=session_id,
                   runtime_id=runtime_id, question=question, choices=choices,
                   requires_user=requires_user is not False, multi_select=multi_select,
                   status="open", created_at=time.time(), review=None, answer=None,
                   answered_by=None)
        with self._db() as db:
            db.execute("INSERT INTO questions VALUES (?, ?, ?, ?)",
                       (row["id"], "open", json.dumps(row), row["created_at"]))
        return row

    def get(self, question_id: str) -> dict | None:
        with self._db() as db:
            row = db.execute("SELECT payload FROM questions WHERE id=?", (question_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self, *, include_answered: bool = False, limit: int = 200, offset: int = 0,
             query: str = "") -> list[dict]:
        clauses = [] if include_answered else ["(status='open' OR json_extract(payload, '$.delivery_pending')=1)"]
        args = []
        if query:
            clauses.append("(instr(lower(json_extract(payload, '$.question')), lower(?)) > 0 "
                           "OR instr(lower(json_extract(payload, '$.session_id')), lower(?)) > 0)")
            args.extend([query, query])
        with self._db() as db:
            rows = db.execute(
                "SELECT payload FROM questions " + ("WHERE " + " AND ".join(clauses) + " " if clauses else "")
                + "ORDER BY created, id LIMIT ? OFFSET ?", (*args, min(max(limit, 1), 500), max(offset, 0))).fetchall()
        return [json.loads(row[0]) for row in rows]

    def answer(self, question_id: str, answer: str | list, *, actor: str = "user",
               review: dict | None = None, delivery_pending: bool = False) -> bool:
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            result = db.execute("SELECT payload FROM questions WHERE id=? AND status='open'",
                                (question_id,)).fetchone()
            if not result:
                return False
            row = json.loads(result[0])
            if actor != "user":
                if actor != "reviewer" or row["requires_user"] or not review:
                    return False
                if not valid_review(row, review):
                    return False
                answer = review["answer"]
            if not isinstance(answer, (str, list)) or not answer:
                return False
            if isinstance(answer, list) and (not row["multi_select"] or
                    not all(isinstance(v, str) and v.strip() for v in answer)):
                return False
            row.update(status="answered", answer=answer, answered_by=actor, delivery_pending=delivery_pending,
                       answered_at=time.time())
            if review:
                row["review"] = review
            db.execute("UPDATE questions SET status='answered', payload=? WHERE id=?",
                       (json.dumps(row), question_id))
        return True

    def acknowledge_delivery(self, question_id: str) -> None:
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            result = db.execute("SELECT payload FROM questions WHERE id=?", (question_id,)).fetchone()
            if result:
                row = json.loads(result[0])
                row["delivery_pending"] = False
                db.execute("UPDATE questions SET payload=? WHERE id=?", (json.dumps(row), question_id))

    def record_review(self, question_id: str, review: dict) -> None:
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            result = db.execute("SELECT payload FROM questions WHERE id=? AND status='open'",
                                (question_id,)).fetchone()
            if result:
                row = json.loads(result[0])
                row["review"] = review
                db.execute("UPDATE questions SET payload=? WHERE id=?", (json.dumps(row), question_id))


def valid_review(question: dict, review: dict) -> bool:
    """A reviewer may select existing options, never invent consent or prose."""
    if question["requires_user"] or not question["choices"]:
        return False
    if review.get("decision") != "answer" or review.get("safe") is not True:
        return False
    evidence = review.get("evidence")
    if not isinstance(evidence, dict) or not all(evidence.get(k) for k in ("markdown", "hindsight")):
        return False
    answer = review.get("answer")
    values = answer if isinstance(answer, list) else [answer]
    return (bool(values) and (question["multi_select"] or len(values) == 1)
            and all(isinstance(v, str) and v in question["choices"] for v in values))

"""Durable interrupted-turn markers for the desktop/TUI auto-continue path.

SQLite may contain partial mid-turn work even when the marker is missing.
The marker records recovery intent/attempts; a prompt-free terminal receipt
records completion, explicit cancellation or handled failure. Raw transcript
fallback is manual-only because a dangling tail alone cannot identify why a
turn stopped. ``session.resume`` checks the live turn lease before recovery.

Recovery claims serialize cold resumes across clients/processes. A dead claim
owner can be replaced; a live PID cannot. PID reuse can conservatively defer
recovery, never authorize duplicate execution.

Markers are stored per ``HERMES_HOME``. Completed receipts are bounded;
unfinished intent is retained until explicitly concluded. Start writes are
mandatory before work executes. Storage errors are errors, not "no marker".
"""

from __future__ import annotations

import contextlib
import uuid
import json
import logging
import math
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_MARKER_DIR = "desktop"
_MARKER_FILE = "interrupted_turns.json"
_MAX_AGE_SECS = 24 * 3600
_MAX_ENTRIES = 32
# Enough to re-submit any realistic prompt; guards the sidecar against a
# pathological multi-megabyte paste being journaled on every turn.
_MAX_PROMPT_CHARS = 64_000

_lock = threading.Lock()


def inspect_interrupted_tail(
    home: Path | str, session_key: str, rows: list[dict]
) -> dict | None:
    """Classify a bounded RAW tip, before alternation repair invents results.

    A dangling tool tail proves no final reply was stored, not why it stopped.
    Older runtimes lack durable turn outcomes, so absence of a marker must NEVER
    authorize automatic execution. Session ended_at is deliberately irrelevant.
    """
    tail = rows[-128:]
    if not tail:
        return None
    last = tail[-1]
    if not (
        last.get("role") == "tool"
        or (last.get("role") == "assistant" and last.get("tool_calls"))
    ):
        return None
    entry = _load(_marker_path(home)).get(session_key, {})
    # A tool may return after Stop. Only a subsequent user turn can supersede
    # that receipt; a late tool timestamp cannot revoke the user's cancellation.
    if entry.get("terminal_reason") and not any(
        row.get("role") == "user"
        and float(row.get("timestamp") or 0) > float(entry.get("finished_at") or 0)
        for row in tail
    ):
        return None
    return {
        "state": "interrupted",
        "source": "raw_transcript",
        "reason": "missing_marker",
        "needs_manual_continue": True,
        "interrupted_at": float(last.get("timestamp") or 0),
    }


@contextlib.contextmanager
def _locked(home, *, blocking=False):
    # Serialize all sidecar read/modify/write transactions across backend PIDs.
    # Critical reads/writes wait for brief transactions instead of losing intent.
    with _lock:
        path = _marker_path(home).with_suffix(".lock")
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a+b") as handle:
            if os.name == "nt":
                import msvcrt

                handle.seek(0, os.SEEK_END)
                if handle.tell() == 0:
                    handle.write(b"0")
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK if blocking else msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
            try:
                yield
            finally:
                if os.name == "nt":
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def claim_turn_recovery(home, session_key, expected) -> str | None:
    """Compare-and-claim the exact marker, counting attempts before agent build."""
    try:
        with _locked(home, blocking=True):
            path = _marker_path(home)
            entries = _load(path)
            entry = entries.get(session_key, {})
            if entry != expected or entry.get("suppression") or not entry.get("prompt"):
                return None
            pid = entry.get("claim_pid")
            if pid:
                from gateway.status import _pid_exists

                if int(pid) <= 0 or _pid_exists(int(pid)):
                    return None
            token = uuid.uuid4().hex
            entry.update(
                claim=token,
                claim_pid=os.getpid(),
                attempts=int(entry.get("attempts", 0)) + 1,
            )
            _store(path, entries)
            return token
    except Exception as exc:
        logger.error("turn recovery claim failed session=%s: %s", session_key, exc)
        raise RuntimeError(f"recovery_marker_claim_failed: {exc}") from exc


def release_turn_recovery(home, session_key, token) -> None:
    try:
        with _locked(home, blocking=True):
            path = _marker_path(home)
            entries = _load(path)
            entry = entries.get(session_key, {})
            if entry.get("claim") == token:
                entry.pop("claim", None)
                entry.pop("claim_pid", None)
                _store(path, entries)
    except Exception:
        logger.error("turn recovery release failed session=%s", session_key)
        raise


def _marker_path(home: Path | str) -> Path:
    return Path(home) / _MARKER_DIR / _MARKER_FILE


def _load(path: Path) -> dict[str, dict]:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    except Exception as exc:
        raise RuntimeError(f"recovery_marker_read_failed: {type(exc).__name__}: {exc}") from exc
    if not isinstance(data, dict) or any(not isinstance(v, dict) for v in data.values()):
        raise RuntimeError("recovery_marker_read_failed: invalid marker store structure")
    return data


def _prune(entries: dict[str, dict], now: float) -> dict[str, dict]:
    # Unfinished intent is not a cache. Other sessions' completed receipts
    # must never evict it, regardless of how long the backend was offline.
    unfinished = {key: entry for key, entry in entries.items() if entry.get("prompt")}
    fresh = {
        key: entry
        for key, entry in entries.items()
        if key not in unfinished and now - float(entry.get("started_at") or 0) <= _MAX_AGE_SECS
    }
    newest = sorted(
        fresh.items(),
        key=lambda item: float(item[1].get("started_at") or 0),
        reverse=True,
    )[:_MAX_ENTRIES]
    return {**unfinished, **dict(newest)}


def _store(path: Path, entries: dict[str, dict]) -> None:
    if not entries:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".turn-marker-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(entries, f)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def record_turn_start(
    home: Path | str, session_key: str, prompt: str, *, attempts: int = 0
) -> None:
    """Persist the marker for a turn that is about to run.

    ``attempts`` counts how many auto-continues led to this run: 0 for a
    user-initiated turn, N for the Nth automatic re-run — the crash-loop
    breaker reads it back on the next resume.
    """
    if not session_key or not prompt:
        return
    now = time.time()
    entry = {
        "attempts": max(0, int(attempts)),
        "prompt": prompt[:_MAX_PROMPT_CHARS],
        "started_at": now,
    }
    try:
        with _locked(home, blocking=True):
            path = _marker_path(home)
            entries = _prune(_load(path), now)
            previous = entries.get(session_key, {})
            if attempts and previous.get("claim"):
                entry.update(
                    claim=previous["claim"], claim_pid=previous.get("claim_pid")
                )
            entries[session_key] = entry
            _store(path, entries)
            logger.info("turn marker recorded session=%s attempt=%d", session_key, entry["attempts"])
    except Exception as exc:
        logger.error("failed to record turn marker session=%s: %s", session_key, exc)
        raise RuntimeError(f"recovery_marker_write_failed: {exc}") from exc


def clear_turn_marker(
    home: Path | str, session_key: str, *, reason: str = "concluded"
) -> None:
    """Durably retire before acknowledging completion; never drop contention."""
    if not session_key:
        return
    try:
        with _locked(home, blocking=True):
            path = _marker_path(home)
            entries = _load(path)
            # Keep a prompt-free terminal receipt. A later raw dangling tail
            # must not reinterpret an explicit stop/failure as a process crash.
            entries[session_key] = {
                "terminal_reason": reason,
                "finished_at": time.time(),
                "started_at": time.time(),
            }
            _store(path, _prune(entries, time.time()))
            logger.info("turn marker retired session=%s reason=%s", session_key, reason)
    except Exception:
        logger.error("failed to retire turn marker session=%s", session_key)
        raise


def suppress_turn_marker(
    home: Path | str, session_key: str, reason: str, *, expected: dict | None = None
) -> None:
    """Sticky policy decision, reset only by an explicit new turn."""
    try:
        with _locked(home):
            path = _marker_path(home)
            entries = _load(path)
            if session_key in entries and (
                expected is None or entries[session_key] == expected
            ):
                entries[session_key]["suppression"] = reason
                _store(path, entries)
                logger.info(
                    "turn recovery suppressed session=%s reason=%s", session_key, reason
                )
    except Exception:
        logger.debug("turn suppression write failed session=%s", session_key)


def read_turn_marker(home: Path | str, session_key: str) -> dict[str, Any] | None:
    """The marker left by a turn that never concluded, or None."""
    if not session_key:
        return None
    try:
        with _locked(home, blocking=True):
            entry = _load(_marker_path(home)).get(session_key)
    except Exception as exc:
        raise RuntimeError(f"recovery_marker_read_failed: {exc}") from exc
    if not isinstance(entry, dict):
        return None
    prompt = str(entry.get("prompt") or "")
    if not prompt.strip():
        return None
    try:
        started_at = float(entry.get("started_at") or 0)
        attempts = max(0, int(entry.get("attempts") or 0))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(started_at) or started_at <= 0:
        return None
    return {**entry, "attempts": attempts, "prompt": prompt, "started_at": started_at}

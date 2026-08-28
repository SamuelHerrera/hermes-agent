"""Regression: a blocking gateway approval wait must honor an interrupt (#8697).

When an agent calls a dangerous command, the gateway approval flow blocks the
agent's execution thread inside ``_await_gateway_decision`` on
``threading.Event.wait()`` until the user responds or the 5-minute approval
timeout elapses.  Before the fix, ``/stop`` (which calls
``AIAgent.interrupt()`` → per-thread interrupt flag) was silently ignored by
that wait loop, so the session stayed wedged until the timeout fired.

The fix checks ``is_interrupted()`` at the top of the poll loop.  Because the
wait runs on the agent's execution thread — the exact thread
``AIAgent.interrupt()`` flags — the check sees the signal and resolves the
pending approval as ``deny`` so the agent loop unwinds cleanly.
"""

import os
import threading
import time

import pytest


def _clear_approval_state():
    """Reset all module-level approval state between tests."""
    from tools import approval as mod
    mod._gateway_queues.clear()
    mod._gateway_notify_cbs.clear()
    mod._session_approved.clear()
    mod._permanent_approved.clear()
    mod._pending.clear()


class TestApprovalInterrupt:
    SESSION_KEY = "interrupt-test-session"

    def setup_method(self):
        from tools.interrupt import set_interrupt
        from tools import interrupt as _interrupt_mod

        _clear_approval_state()
        # Wipe ALL per-thread interrupt bits — thread idents are recycled by
        # the OS, so a bit set on a now-dead thread in a prior test can leak
        # onto a fresh worker that happens to reuse the ident.
        with _interrupt_mod._lock:
            _interrupt_mod._interrupted_threads.clear()
        set_interrupt(False)
        self._saved_env = {
            k: os.environ.get(k)
            for k in ("HERMES_GATEWAY_SESSION", "HERMES_YOLO_MODE",
                      "HERMES_SESSION_KEY")
        }
        os.environ.pop("HERMES_YOLO_MODE", None)
        os.environ["HERMES_GATEWAY_SESSION"] = "1"
        os.environ["HERMES_SESSION_KEY"] = self.SESSION_KEY

    def teardown_method(self):
        from tools.interrupt import set_interrupt
        from tools import interrupt as _interrupt_mod

        with _interrupt_mod._lock:
            _interrupt_mod._interrupted_threads.clear()
        set_interrupt(False)
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        _clear_approval_state()

    def test_interrupt_unblocks_pending_approval_quickly(self):
        """An interrupt on the waiting thread must resolve the wait as deny
        well before the (here, intentionally long) approval timeout."""
        from tools import approval as mod
        from tools.interrupt import set_interrupt

        # Force a long timeout so a *passing* test can only happen via the
        # interrupt path, never by the deadline elapsing.
        mod._get_approval_config = lambda: {"timeout": 300}

        approval_data = {
            "command": "rm -rf /tmp/whatever",
            "description": "recursive delete",
            "pattern_key": "rm_rf",
            "pattern_keys": ["rm_rf"],
        }

        result_holder = {}
        notified = threading.Event()

        def _notify_cb(_data):
            # Mimic the gateway: a callback is registered and invoked once the
            # approval is enqueued.  We just record that the user *would* have
            # been prompted.
            notified.set()

        def _worker():
            result_holder["result"] = mod._await_gateway_decision(
                self.SESSION_KEY, _notify_cb, approval_data
            )
            result_holder["thread_id"] = threading.get_ident()

        t = threading.Thread(target=_worker, daemon=True)
        start = time.monotonic()
        t.start()

        # Wait until the worker has enqueued + notified, proving it is actually
        # blocked inside the poll loop.
        assert notified.wait(timeout=5), "approval was never enqueued/notified"

        # Simulate /stop: AIAgent.interrupt() flags the agent's execution
        # thread.  Here the worker thread *is* that execution thread.
        set_interrupt(True, t.ident)

        t.join(timeout=10)
        elapsed = time.monotonic() - start

        assert not t.is_alive(), "approval wait did not return after interrupt"
        assert result_holder["result"] == {"resolved": True, "choice": "deny", "reason": None}
        # Must be far below the 300s timeout — the interrupt, not the deadline,
        # is what released the wait.
        assert elapsed < 10, f"interrupt path too slow ({elapsed:.1f}s)"
        # Queue entry was cleaned up.
        assert not mod.has_blocking_approval(self.SESSION_KEY)

    def test_unrelated_thread_interrupt_does_not_unblock(self):
        """An interrupt flagged on a *different* thread must NOT release this
        session's approval wait — interrupts are thread-scoped."""
        from tools import approval as mod
        from tools.interrupt import set_interrupt

        # Short timeout so the test finishes fast via the deadline, proving the
        # foreign interrupt did not short-circuit the wait.
        mod._get_approval_config = lambda: {"timeout": 1}

        approval_data = {
            "command": "rm -rf /tmp/whatever",
            "description": "recursive delete",
            "pattern_key": "rm_rf",
            "pattern_keys": ["rm_rf"],
        }
        result_holder = {}
        notified = threading.Event()

        def _notify_cb(_data):
            notified.set()

        def _worker():
            result_holder["result"] = mod._await_gateway_decision(
                self.SESSION_KEY, _notify_cb, approval_data
            )

        t = threading.Thread(target=_worker, daemon=True)
        t.start()
        assert notified.wait(timeout=5)

        # Flag an interrupt on a thread that is NOT the worker.
        set_interrupt(True, threading.get_ident())

        t.join(timeout=10)
        assert not t.is_alive()
        # Timed out (no resolution) because the foreign interrupt was ignored.
        assert result_holder["result"] == {"resolved": False, "choice": None, "reason": None}

    def test_interrupt_wins_when_approval_response_wakes_the_waiter(self):
        """Stop must fail closed even when an approval response signals the
        blocked waiter immediately after the interrupt flag is set."""
        from tools import approval as mod
        from tools.interrupt import set_interrupt

        mod._get_approval_config = lambda: {"timeout": 300}
        approval_data = {
            "command": "rm -rf /tmp/whatever",
            "description": "recursive delete",
            "pattern_key": "rm_rf",
            "pattern_keys": ["rm_rf"],
        }
        result_holder = {}
        notified = threading.Event()
        release_notify = threading.Event()
        wait_entered = threading.Event()

        class _GateEvent:
            def __init__(self):
                self._event = threading.Event()

            def is_set(self):
                return self._event.is_set()

            def set(self):
                self._event.set()

            def wait(self, timeout=None):
                wait_entered.set()
                return self._event.wait(timeout)

        def _notify_cb(_data):
            notified.set()
            assert release_notify.wait(timeout=5)

        def _worker():
            result_holder["result"] = mod._await_gateway_decision(
                self.SESSION_KEY, _notify_cb, approval_data
            )

        worker = threading.Thread(target=_worker, daemon=True)
        worker.start()
        assert notified.wait(timeout=5)
        entry = mod._gateway_queues[self.SESSION_KEY][0]
        entry.event = _GateEvent()
        release_notify.set()
        assert wait_entered.wait(timeout=5)

        set_interrupt(True, worker.ident)
        assert mod.resolve_gateway_approval(self.SESSION_KEY, "once") == 1
        worker.join(timeout=5)

        assert not worker.is_alive()
        assert result_holder["result"] == {
            "resolved": True,
            "choice": "deny",
            "reason": None,
        }

    def test_execute_code_rechecks_interrupt_after_gateway_decision(self, monkeypatch):
        """A Stop arriving as the approval helper returns must block code."""
        from tools import approval as mod
        from tools.interrupt import set_interrupt

        monkeypatch.setattr(mod, "_get_approval_mode", lambda: "manual")
        monkeypatch.setattr(mod, "_is_gateway_approval_context", lambda: True)
        monkeypatch.setattr(mod, "_is_cron_approval_context", lambda: False)
        monkeypatch.setattr(mod, "is_approved", lambda *_args: False)
        mod.register_gateway_notify(self.SESSION_KEY, lambda _data: None)

        def _approve_then_interrupt(*_args, **_kwargs):
            set_interrupt(True)
            return {"resolved": True, "choice": "session", "reason": None}

        monkeypatch.setattr(mod, "_await_gateway_decision", _approve_then_interrupt)

        result = mod.check_execute_code_guard("print('danger')", "local")

        assert result["approved"] is False
        assert result["user_consent"] is False
        with mod._lock:
            assert "execute_code" not in mod._session_approved.get(
                self.SESSION_KEY, set()
            )

    def test_terminal_rechecks_interrupt_before_session_grant(self, monkeypatch):
        """A gateway Stop must prevent both execution and reusable authority."""
        from tools import approval as mod
        from tools.interrupt import set_interrupt

        monkeypatch.setattr(mod, "_get_approval_mode", lambda: "manual")
        monkeypatch.setattr(mod, "_is_gateway_approval_context", lambda: True)
        monkeypatch.setattr(mod, "_is_cron_approval_context", lambda: False)
        monkeypatch.setattr(mod, "is_approved", lambda *_args: False)
        monkeypatch.setattr(mod, "detect_hardline_command", lambda _command: (False, ""))
        monkeypatch.setattr(mod, "_check_sudo_stdin_guard", lambda _command: (False, ""))
        monkeypatch.setattr(mod, "_match_user_deny_rule", lambda _command: None)
        monkeypatch.setattr(
            mod, "_command_matches_permanent_allowlist", lambda _command: False
        )
        monkeypatch.setattr(
            mod,
            "detect_dangerous_command",
            lambda _command: (True, "danger", "dangerous"),
        )
        monkeypatch.setattr(
            "tools.tirith_security.check_command_security",
            lambda _command: {"action": "allow"},
        )
        mod.register_gateway_notify(self.SESSION_KEY, lambda _data: None)

        def _approve_then_interrupt(*_args, **_kwargs):
            set_interrupt(True)
            return {"resolved": True, "choice": "session", "reason": None}

        monkeypatch.setattr(mod, "_await_gateway_decision", _approve_then_interrupt)

        result = mod.check_all_command_guards("rm -rf /tmp/example", "local")

        assert result["approved"] is False
        assert result["user_consent"] is False
        with mod._lock:
            assert "danger" not in mod._session_approved.get(self.SESSION_KEY, set())

    @pytest.mark.parametrize("surface", ["terminal", "execute_code"])
    def test_builtin_rolls_back_grant_if_persistence_interrupts(
        self, monkeypatch, surface
    ):
        from tools import approval as mod
        from tools.interrupt import set_interrupt

        monkeypatch.setattr(mod, "_get_approval_mode", lambda: "manual")
        monkeypatch.setattr(mod, "_is_gateway_approval_context", lambda: True)
        monkeypatch.setattr(mod, "_is_cron_approval_context", lambda: False)
        monkeypatch.setattr(mod, "is_approved", lambda *_args: False)
        mod.register_gateway_notify(self.SESSION_KEY, lambda _data: None)
        monkeypatch.setattr(
            mod,
            "_await_gateway_decision",
            lambda *_args, **_kwargs: {
                "resolved": True,
                "choice": "session",
                "reason": None,
            },
        )
        real_approve_session = mod.approve_session

        def persist_then_interrupt(session_key, pattern_key):
            real_approve_session(session_key, pattern_key)
            set_interrupt(True)

        monkeypatch.setattr(mod, "approve_session", persist_then_interrupt)
        if surface == "terminal":
            monkeypatch.setattr(
                mod, "detect_hardline_command", lambda _command: (False, "")
            )
            monkeypatch.setattr(
                mod, "_check_sudo_stdin_guard", lambda _command: (False, "")
            )
            monkeypatch.setattr(mod, "_match_user_deny_rule", lambda _command: None)
            monkeypatch.setattr(
                mod, "_command_matches_permanent_allowlist", lambda _command: False
            )
            monkeypatch.setattr(
                mod,
                "detect_dangerous_command",
                lambda _command: (True, "danger", "dangerous"),
            )
            monkeypatch.setattr(
                "tools.tirith_security.check_command_security",
                lambda _command: {"action": "allow"},
            )
            result = mod.check_all_command_guards("rm -rf /tmp/example", "local")
            pattern_key = "danger"
        else:
            result = mod.check_execute_code_guard("print('danger')", "local")
            pattern_key = "execute_code"

        assert result["approved"] is False
        assert result["user_consent"] is False
        with mod._lock:
            assert pattern_key not in mod._session_approved.get(
                self.SESSION_KEY, set()
            )

    def test_always_rollback_restores_memory_and_persisted_allowlist(
        self, monkeypatch, tmp_path
    ):
        from tools import approval as mod
        from tools.interrupt import set_interrupt

        allowlist = tmp_path / "allowlist.txt"
        allowlist.write_text("baseline")
        mod._permanent_approved.add("baseline")

        def save(patterns):
            allowlist.write_text("\n".join(sorted(patterns)))

        monkeypatch.setattr(mod, "save_permanent_allowlist", save)
        real_approve_permanent = mod.approve_permanent

        def persist_then_interrupt(pattern_key):
            real_approve_permanent(pattern_key)
            set_interrupt(True)

        monkeypatch.setattr(mod, "approve_permanent", persist_then_interrupt)

        committed = mod._commit_approval_authority(
            self.SESSION_KEY, {"danger"}, {"danger"}
        )

        assert committed is False
        with mod._lock:
            assert "danger" not in mod._session_approved.get(
                self.SESSION_KEY, set()
            )
            assert mod._permanent_approved == {"baseline"}
        assert allowlist.read_text() == "baseline"

    def test_permanent_finalize_failure_never_returns_safe_denial(
        self, monkeypatch, tmp_path
    ):
        from tools import approval as mod
        from tools.interrupt import is_interrupted, set_interrupt

        allowlist = tmp_path / "allowlist.txt"
        allowlist.write_text("baseline")
        mod._permanent_approved.add("baseline")
        save_calls = []

        def write_then_fail_verification(patterns):
            save_calls.append(set(patterns))
            allowlist.write_text("\n".join(sorted(patterns)))
            set_interrupt(True)
            return False

        monkeypatch.setattr(
            mod, "save_permanent_allowlist", write_then_fail_verification
        )

        committed = mod._commit_approval_authority(
            self.SESSION_KEY, {"danger"}, {"danger"}
        )

        assert committed is True
        assert is_interrupted() is True
        assert save_calls == [{"baseline", "danger"}]
        with mod._lock:
            assert "danger" in mod._session_approved[self.SESSION_KEY]
            assert mod._permanent_approved == {"baseline", "danger"}
        assert allowlist.read_text() == "baseline\ndanger"

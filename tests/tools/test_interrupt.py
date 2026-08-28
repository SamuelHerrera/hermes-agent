"""Tests for the interrupt system.

Run with: python -m pytest tests/test_interrupt.py -v
"""

import queue
import threading
import time
import pytest


# ---------------------------------------------------------------------------
# Unit tests: shared interrupt module
# ---------------------------------------------------------------------------

class TestInterruptModule:
    """Tests for tools/interrupt.py"""

    def test_set_and_check(self):
        from tools.interrupt import set_interrupt, is_interrupted
        set_interrupt(False)
        assert not is_interrupted()

        set_interrupt(True)
        assert is_interrupted()

        set_interrupt(False)
        assert not is_interrupted()


    def test_clear_current_thread_interrupt_leaves_other_threads(self):
        """clear_current_thread_interrupt only touches the calling thread."""
        from tools.interrupt import (
            set_interrupt, is_interrupted, clear_current_thread_interrupt,
            _interrupted_threads, _lock,
        )
        with _lock:
            _interrupted_threads.clear()
        other_tid = threading.get_ident() + 1  # an ident that isn't us
        set_interrupt(True, thread_id=other_tid)
        set_interrupt(True)  # current thread
        assert is_interrupted()

        clear_current_thread_interrupt()

        assert not is_interrupted()  # ours cleared
        with _lock:
            assert other_tid in _interrupted_threads  # other thread untouched
            _interrupted_threads.discard(other_tid)

    def test_interrupted_thread_cannot_commit_approval_authority(self):
        from tools.interrupt import commit_if_not_interrupted, set_interrupt

        committed = []
        set_interrupt(True)
        try:
            assert commit_if_not_interrupted(lambda: committed.append(True)) is False
        finally:
            set_interrupt(False)

        assert committed == []

    def test_reentrant_interrupt_rolls_back_commit(self):
        from tools.interrupt import commit_if_not_interrupted, set_interrupt

        authority = []

        def commit():
            authority.append("grant")
            set_interrupt(True)

        def rollback():
            authority.remove("grant")

        try:
            assert commit_if_not_interrupted(commit, rollback) is False
        finally:
            set_interrupt(False)

        assert authority == []

    def test_approval_commit_and_stop_share_one_linearization_lock(self):
        from tools.interrupt import (
            _interrupted_threads,
            _lock,
            commit_if_not_interrupted,
            set_interrupt,
        )

        worker_ready = threading.Event()
        commit_entered = threading.Event()
        stop_started = threading.Event()
        release_commit = threading.Event()
        result = {}

        def commit():
            commit_entered.set()
            assert stop_started.wait(timeout=5)
            assert release_commit.wait(timeout=5)
            result["authority"] = True

        def worker():
            result["thread_id"] = threading.get_ident()
            worker_ready.set()
            result["committed"] = commit_if_not_interrupted(commit)

        approval_thread = threading.Thread(target=worker)
        approval_thread.start()
        assert worker_ready.wait(timeout=5)
        assert commit_entered.wait(timeout=5)

        def stop():
            stop_started.set()
            set_interrupt(True, thread_id=result["thread_id"])

        stop_thread = threading.Thread(target=stop)
        stop_thread.start()
        assert stop_started.wait(timeout=5)
        release_commit.set()
        approval_thread.join(timeout=5)
        stop_thread.join(timeout=5)

        assert result["committed"] is True
        assert result["authority"] is True
        with _lock:
            assert result["thread_id"] in _interrupted_threads
            _interrupted_threads.discard(result["thread_id"])

    def test_execution_start_and_stop_share_one_linearization_lock(self):
        from tools.interrupt import (
            _interrupted_threads,
            _lock,
            start_if_not_interrupted,
            set_interrupt,
        )

        effect_entered = threading.Event()
        release_effect = threading.Event()
        stop_started = threading.Event()
        order = []
        result = {}

        def effect():
            effect_entered.set()
            assert stop_started.wait(timeout=5)
            assert release_effect.wait(timeout=5)
            order.append("effect")
            return "process"

        def worker():
            result["thread_id"] = threading.get_ident()
            result["start"] = start_if_not_interrupted(effect)

        execution_thread = threading.Thread(target=worker)
        execution_thread.start()
        assert effect_entered.wait(timeout=5)

        def stop():
            stop_started.set()
            set_interrupt(True, thread_id=result["thread_id"])
            order.append("stop")

        stop_thread = threading.Thread(target=stop)
        stop_thread.start()
        assert stop_started.wait(timeout=5)
        release_effect.set()
        execution_thread.join(timeout=5)
        stop_thread.join(timeout=5)

        assert not execution_thread.is_alive()
        assert not stop_thread.is_alive()
        assert result["start"].started is True
        assert result["start"].value == "process"
        assert result["start"].interrupted_during_start is False
        assert order == ["effect", "stop"]
        with _lock:
            _interrupted_threads.discard(result["thread_id"])

    def test_slow_start_does_not_block_stop_for_an_unrelated_thread(self):
        from tools.interrupt import set_interrupt, start_if_not_interrupted

        start_entered = threading.Event()
        release_start = threading.Event()
        start_done = threading.Event()
        unrelated_stop_done = threading.Event()

        def slow_start():
            def effect():
                start_entered.set()
                assert release_start.wait(timeout=5)

                return object()

            start_if_not_interrupted(effect)
            start_done.set()

        starter = threading.Thread(target=slow_start)
        starter.start()
        assert start_entered.wait(timeout=5)

        unrelated_tid = threading.get_ident()

        def stop_unrelated():
            set_interrupt(True, unrelated_tid)
            unrelated_stop_done.set()

        stopper = threading.Thread(target=stop_unrelated)
        stopper.start()

        try:
            assert unrelated_stop_done.wait(timeout=2)
        finally:
            release_start.set()
            starter.join(timeout=5)
            stopper.join(timeout=5)
            set_interrupt(False, unrelated_tid)

        assert start_done.is_set()

    def test_execution_does_not_start_after_stop_linearizes(self):
        from tools.interrupt import (
            _interrupted_threads,
            _lock,
            start_if_not_interrupted,
            set_interrupt,
        )

        worker_ready = threading.Event()
        effects = []
        result = {}

        def worker():
            result["thread_id"] = threading.get_ident()
            worker_ready.set()
            result["start"] = start_if_not_interrupted(
                lambda: effects.append("started")
            )

        with _lock:
            execution_thread = threading.Thread(target=worker)
            execution_thread.start()
            assert worker_ready.wait(timeout=5)
            set_interrupt(True, thread_id=result["thread_id"])

        execution_thread.join(timeout=5)

        assert not execution_thread.is_alive()
        assert result["start"].started is False
        assert result["start"].value is None
        assert effects == []
        with _lock:
            _interrupted_threads.discard(result["thread_id"])

    def test_reentrant_stop_is_reported_after_start_without_deadlock(self):
        from tools.interrupt import start_if_not_interrupted, set_interrupt

        def start():
            set_interrupt(True)
            return "process"

        try:
            result = start_if_not_interrupted(start)
        finally:
            set_interrupt(False)

        assert result.started is True
        assert result.value == "process"
        assert result.interrupted_during_start is True

    def test_environment_interruptible_start_skips_run_bash_after_stop(
        self, monkeypatch, tmp_path
    ):
        from tools.environments.local import LocalEnvironment
        from tools.interrupt import set_interrupt

        env = LocalEnvironment(cwd=str(tmp_path), timeout=5)
        starts = []

        def forbidden_start(*_args, **_kwargs):
            starts.append(True)
            raise AssertionError("process start must not run after Stop")

        monkeypatch.setattr(env, "_run_bash", forbidden_start)
        set_interrupt(True)
        try:
            result = env.execute("echo unsafe", interruptible_start=True)
        finally:
            set_interrupt(False)
            env.cleanup()

        assert result["returncode"] == 130
        assert result["interrupted_before_start"] is True
        assert starts == []

    def test_interruptible_execute_preserves_legacy_base_subclass_signature(self):
        from tools.environments.base import (
            BaseEnvironment,
            execute_with_interruptible_start,
        )

        class LegacyEnvironment(BaseEnvironment):
            def __init__(self):
                self.calls = []

            def execute(  # type: ignore[override] - exercises the pre-option contract
                self,
                command,
                cwd="",
                *,
                timeout=None,
                stdin_data=None,
                rewrite_compound_background=True,
                bounded_capture=False,
            ):
                del stdin_data, rewrite_compound_background, bounded_capture
                self.calls.append((command, timeout, cwd))
                return {"output": "legacy", "returncode": 0}

            def cleanup(self):
                return None

        environment = LegacyEnvironment()
        result = execute_with_interruptible_start(
            environment,
            "pwd",
            timeout=5,
            cwd="/tmp",
            cancel_on_interrupt=False,
        )

        assert result == {"output": "legacy", "returncode": 0}
        assert environment.calls == [("pwd", 5, "/tmp")]


# ---------------------------------------------------------------------------
# Unit tests: pre-tool interrupt check
# ---------------------------------------------------------------------------

class TestPreToolCheck:
    """Verify that _execute_tool_calls skips all tools when interrupted."""

    def test_all_tools_skipped_when_interrupted(self):
        """Mock an interrupted agent and verify no tools execute."""
        from unittest.mock import MagicMock

        # Build a fake assistant_message with 3 tool calls
        tc1 = MagicMock()
        tc1.id = "tc_1"
        tc1.function.name = "terminal"
        tc1.function.arguments = '{"command": "rm -rf /"}'

        tc2 = MagicMock()
        tc2.id = "tc_2"
        tc2.function.name = "terminal"
        tc2.function.arguments = '{"command": "echo hello"}'

        tc3 = MagicMock()
        tc3.id = "tc_3"
        tc3.function.name = "web_search"
        tc3.function.arguments = '{"query": "test"}'

        assistant_msg = MagicMock()
        assistant_msg.tool_calls = [tc1, tc2, tc3]

        messages = []

        # Create a minimal mock agent with _interrupt_requested = True
        agent = MagicMock()
        agent._interrupt_requested = True
        agent.log_prefix = ""
        agent._persist_session = MagicMock()
        # PR #72425: execute_tool_calls_* read _incremental_persistence_failed
        # via getattr at loop top. A bare MagicMock auto-creates a truthy value
        # for any attribute access, which would short-circuit the interrupt
        # skip path before any cancelled-tool messages are appended.
        agent._incremental_persistence_failed = False

        # Import and call the method
        import types
        from run_agent import AIAgent
        # Bind the real methods to our mock so dispatch works correctly
        agent._execute_tool_calls_sequential = types.MethodType(AIAgent._execute_tool_calls_sequential, agent)
        agent._execute_tool_calls_concurrent = types.MethodType(AIAgent._execute_tool_calls_concurrent, agent)
        AIAgent._execute_tool_calls(agent, assistant_msg, messages, "default")

        # All 3 should be skipped
        assert len(messages) == 3
        for msg in messages:
            assert msg["role"] == "tool"
            assert "cancelled" in msg["content"].lower() or "interrupted" in msg["content"].lower()

        # No actual tool handlers should have been called
        # (handle_function_call should NOT have been invoked)


# ---------------------------------------------------------------------------
# Unit tests: message combining
# ---------------------------------------------------------------------------

class TestMessageCombining:
    """Verify multiple interrupt messages are joined."""

    def test_cli_interrupt_queue_drain(self):
        """Simulate draining multiple messages from the interrupt queue."""
        q = queue.Queue()
        q.put("Stop!")
        q.put("Don't delete anything")
        q.put("Show me what you were going to delete instead")

        parts = []
        while not q.empty():
            try:
                msg = q.get_nowait()
                if msg:
                    parts.append(msg)
            except queue.Empty:
                break

        combined = "\n".join(parts)
        assert "Stop!" in combined
        assert "Don't delete anything" in combined
        assert "Show me what you were going to delete instead" in combined
        assert combined.count("\n") == 2

    def test_gateway_pending_messages_append(self):
        """Simulate gateway _pending_messages append logic."""
        pending = {}
        key = "agent:main:telegram:dm"

        # First message
        if key in pending:
            pending[key] += "\n" + "Stop!"
        else:
            pending[key] = "Stop!"

        # Second message
        if key in pending:
            pending[key] += "\n" + "Do something else instead"
        else:
            pending[key] = "Do something else instead"

        assert pending[key] == "Stop!\nDo something else instead"


# ---------------------------------------------------------------------------
# Integration tests (require local terminal)
# ---------------------------------------------------------------------------

class TestSIGKILLEscalation:
    """Test that SIGTERM-resistant processes get SIGKILL'd."""

    @pytest.mark.skipif(
        not __import__("shutil").which("bash"),
        reason="Requires bash"
    )
    def test_sigterm_trap_killed_within_2s(self):
        """A process that traps SIGTERM should be SIGKILL'd after 1s grace."""
        from tools.interrupt import set_interrupt
        from tools.environments.local import LocalEnvironment

        set_interrupt(False)
        env = LocalEnvironment(cwd="/tmp", timeout=30)

        # Start execution in a thread, interrupt after 0.5s
        result_holder = {"value": None}

        def _run():
            result_holder["value"] = env.execute(
                "trap '' TERM; sleep 60",
                timeout=30,
            )

        t = threading.Thread(target=_run)
        t.start()

        time.sleep(0.5)
        set_interrupt(True, thread_id=t.ident)

        t.join(timeout=5)
        set_interrupt(False, thread_id=t.ident)

        assert result_holder["value"] is not None
        assert result_holder["value"]["returncode"] == 130
        assert "interrupted" in result_holder["value"]["output"].lower()


# ---------------------------------------------------------------------------
# Regression: _run_tool cleanup on BaseException (issue #35309)
# ---------------------------------------------------------------------------

class TestRunToolCleanupOnBaseException:
    """Verify that _run_tool cleans up _interrupted_threads even when
    _invoke_tool raises a BaseException (e.g. CancelledError).

    Regression test for #35309: without the finally block, a BaseException
    bypasses ``except Exception``, leaking the worker tid into
    _interrupted_threads.  ThreadPoolExecutor recycles tids, so the next
    tool scheduled on the same thread is instantly "interrupted".
    """

    def test_cleanup_on_base_exception(self):
        from unittest.mock import MagicMock, patch
        import types
        from tools.interrupt import set_interrupt, is_interrupted, _interrupted_threads, _lock

        # Clear global state
        with _lock:
            _interrupted_threads.clear()

        # Build a minimal mock agent with the attributes _run_tool needs
        agent = MagicMock()
        agent._interrupt_requested = False
        agent._tool_worker_threads = set()
        agent._tool_worker_threads_lock = threading.Lock()

        # _set_interrupt delegates to the real module
        def _mock_set_interrupt(active, tid=None):
            set_interrupt(active, tid)
        agent._set_interrupt = _mock_set_interrupt

        # _invoke_tool raises BaseException (simulating CancelledError)
        agent._invoke_tool = MagicMock(side_effect=BaseException("simulated CancelledError"))

        # Bind the real concurrent method so we get _run_tool
        from run_agent import AIAgent
        agent._execute_tool_calls_concurrent = types.MethodType(
            AIAgent._execute_tool_calls_concurrent, agent
        )

        # Build a single tool call
        tc = MagicMock()
        tc.id = "tc_base_exc"
        tc.function.name = "dummy_tool"
        tc.function.arguments = "{}"

        assistant_msg = MagicMock()
        assistant_msg.tool_calls = [tc]

        # _execute_tool_calls_concurrent will submit _run_tool to a
        # ThreadPoolExecutor.  The BaseException propagates out of the
        # worker, but the finally block should still clean up.
        try:
            agent._execute_tool_calls_concurrent(assistant_msg, [], "default")
        except Exception:
            pass  # ThreadPoolExecutor may re-raise

        # After the worker finishes (even with BaseException), the worker
        # tid should have been removed from _interrupted_threads and
        # _tool_worker_threads.
        assert len(agent._tool_worker_threads) == 0, (
            f"_tool_worker_threads not cleaned up: {agent._tool_worker_threads}"
        )

        # Verify no stale tid is left in the global interrupt set.  The
        # worker thread is recycled by ThreadPoolExecutor, so a leaked tid
        # would poison the next task on that thread.  We cleared the set at
        # the start and never set any interrupt ourselves, so a leak from
        # _run_tool is the only way an entry could land here.
        with _lock:
            leaked = set(_interrupted_threads)
        assert leaked == set(), f"leaked tids in _interrupted_threads: {leaked}"


# ---------------------------------------------------------------------------
# Manual smoke test checklist (not automated)
# ---------------------------------------------------------------------------

SMOKE_TESTS = """
Manual Smoke Test Checklist:

1. CLI: Run `hermes`, ask it to `sleep 30` in terminal, type "stop" + Enter.
   Expected: command dies within 2s, agent responds to "stop".

2. CLI: Ask it to extract content from 5 URLs, type interrupt mid-way.
   Expected: remaining URLs are skipped, partial results returned.

3. Gateway (Telegram): Send a long task, then send "Stop".
   Expected: agent stops and responds acknowledging the stop.

4. Gateway (Telegram): Send "Stop" then "Do X instead" rapidly.
   Expected: both messages appear as the next prompt (joined by newline).

5. CLI: Start a task that generates 3+ tool calls in one batch.
   Type interrupt during the first tool call.
   Expected: only 1 tool executes, remaining are skipped.
"""

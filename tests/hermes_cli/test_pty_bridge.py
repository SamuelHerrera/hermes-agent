"""Unit tests for hermes_cli.pty_bridge — PTY spawning + byte forwarding.

These tests drive the bridge with minimal POSIX processes (echo, env, sleep,
printf) to verify it behaves like a PTY you can read/write/resize/close.
"""

from __future__ import annotations

import os
import shutil
import signal
import sys
import time

import pytest

# These tests deliberately signal owned jobs after shell exit/reparenting.
pytestmark = pytest.mark.live_system_guard_bypass

pytest.importorskip("ptyprocess", reason="ptyprocess not installed")

from hermes_cli.pty_bridge import PtyBridge, PtyUnavailableError


skip_on_windows = pytest.mark.skipif(
    sys.platform.startswith("win"), reason="PTY bridge is POSIX-only"
)


def _read_until(bridge: PtyBridge, needle: bytes, timeout: float = 5.0) -> bytes:
    """Accumulate PTY output until we see `needle` or time out."""
    deadline = time.monotonic() + timeout
    buf = bytearray()
    while time.monotonic() < deadline:
        chunk = bridge.read(timeout=0.2)
        if chunk is None:
            break
        buf.extend(chunk)
        if needle in buf:
            return bytes(buf)
    return bytes(buf)


@skip_on_windows
class TestPtyBridgeSpawn:
    def test_is_available_on_posix(self):
        assert PtyBridge.is_available() is True

    def test_spawn_returns_bridge_with_pid(self):
        bridge = PtyBridge.spawn(["true"])
        try:
            assert bridge.pid > 0
        finally:
            bridge.close()

    def test_spawn_raises_on_missing_argv0(self, tmp_path):
        with pytest.raises((FileNotFoundError, OSError)):
            PtyBridge.spawn([str(tmp_path / "definitely-not-a-real-binary")])


@skip_on_windows
class TestPtyBridgeIO:

    def test_write_sends_to_child_stdin(self):
        # `cat` with no args echoes stdin back to stdout.  We write a line,
        # read it back, then signal EOF to let cat exit cleanly.
        bridge = PtyBridge.spawn([shutil.which("cat") or "cat"])
        try:
            bridge.write(b"hello-pty\n")
            output = _read_until(bridge, b"hello-pty")
            assert b"hello-pty" in output
        finally:
            bridge.close()

    def test_read_returns_none_after_child_exits(self):
        bridge = PtyBridge.spawn(["/bin/sh", "-c", "printf done"])
        try:
            _read_until(bridge, b"done")
            # Give the child a beat to exit cleanly, then drain until EOF.
            deadline = time.monotonic() + 3.0
            while bridge.is_alive() and time.monotonic() < deadline:
                bridge.read(timeout=0.1)
            # Next reads after exit should return None (EOF), not raise.
            got_none = False
            for _ in range(10):
                if bridge.read(timeout=0.1) is None:
                    got_none = True
                    break
            assert got_none, "PtyBridge.read did not return None after child EOF"
        finally:
            bridge.close()


@skip_on_windows
class TestPtyBridgeResize:
    def test_resize_updates_child_winsize(self):
        # Query the TTY ioctl directly instead of using tput, which requires
        # TERM and fails in GitHub Actions' non-interactive environment.
        winsize_script = (
            "import fcntl, struct, termios, time; "
            "time.sleep(0.1); "
            "rows, cols, *_ = struct.unpack('HHHH', "
            "fcntl.ioctl(0, termios.TIOCGWINSZ, b'\\0' * 8)); "
            "print(cols); print(rows)"
        )
        bridge = PtyBridge.spawn(
            [sys.executable, "-c", winsize_script],
            cols=80,
            rows=24,
        )
        try:
            bridge.resize(cols=123, rows=45)
            output = _read_until(bridge, b"45", timeout=5.0)
            # tput prints just the numbers, one per line
            assert b"123" in output
            assert b"45" in output
        finally:
            bridge.close()


@skip_on_windows
class TestClampDimension:
    def test_clamps_above_max(self):
        from hermes_cli.pty_bridge import _MAX_COLS, _MAX_ROWS, _clamp_dimension

        assert _clamp_dimension(131072, _MAX_COLS) == _MAX_COLS
        assert _clamp_dimension(131072, _MAX_ROWS) == _MAX_ROWS


    def test_non_numeric_falls_back_to_min(self):
        from hermes_cli.pty_bridge import _MAX_COLS, _clamp_dimension

        assert _clamp_dimension(None, _MAX_COLS) == 1  # type: ignore[arg-type]
        assert _clamp_dimension(float("nan"), _MAX_COLS) == 1  # type: ignore[arg-type]
        assert _clamp_dimension(float("inf"), _MAX_COLS) == 1  # type: ignore[arg-type]

    def test_clamped_values_pack_as_unsigned_short(self):
        # The whole point: clamped output must never raise struct.error.
        import struct as _struct

        from hermes_cli.pty_bridge import _MAX_COLS, _MAX_ROWS, _clamp_dimension

        cols = _clamp_dimension(131072, _MAX_COLS)
        rows = _clamp_dimension(1, _MAX_ROWS)
        # Should not raise.
        _struct.pack("HHHH", rows, cols, 0, 0)


@skip_on_windows
class TestPtyBridgeClose:
    def test_close_is_idempotent(self):
        bridge = PtyBridge.spawn(["/bin/sh", "-c", "sleep 30"])
        bridge.close()
        bridge.close()  # must not raise
        assert not bridge.is_alive()

    def test_close_terminates_long_running_child(self):
        bridge = PtyBridge.spawn(["/bin/sh", "-c", "sleep 30"])
        pid = bridge.pid
        bridge.close()
        # Give the kernel a moment to reap
        deadline = time.monotonic() + 3.0
        reaped = False
        while time.monotonic() < deadline:
            try:
                os.kill(pid, 0)
                time.sleep(0.05)
            except ProcessLookupError:
                reaped = True
                break
        assert reaped, f"pid {pid} still running after close()"

    @pytest.mark.parametrize("background", [False, True])
    def test_close_kills_interactive_job_groups(self, tmp_path, background):
        import psutil
        import shlex
        pidfile = tmp_path / "child.pid"
        # Ignore both graceful signals to exercise escalation after bash exits.
        script = ("import os,signal,time; "
                  "signal.signal(signal.SIGHUP, signal.SIG_IGN); "
                  "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
                  f"open({str(pidfile)!r}, 'w').write(str(os.getpid())); "
                  "time.sleep(120)")
        bridge = PtyBridge.spawn(["/bin/bash", "--noprofile", "--norc", "-i"])
        child = None
        unrelated = __import__("subprocess").Popen(["sleep", "120"])
        try:
            command = shlex.quote(sys.executable) + " -c " + shlex.quote(script)
            bridge.write((command + (" &" if background else "") + "\n").encode())
            deadline = time.monotonic() + 5
            while not pidfile.exists() and time.monotonic() < deadline:
                bridge.read(timeout=0.05)
            assert pidfile.exists()
            child = psutil.Process(int(pidfile.read_text()))
            assert os.getpgid(child.pid) != os.getpgid(bridge.pid)
            bridge.close()
            assert not child.is_running() or child.status() == psutil.STATUS_ZOMBIE
            assert unrelated.poll() is None
        finally:
            bridge.close()
            if child and child.is_running():
                child.kill()
            unrelated.terminate()
            unrelated.wait(timeout=3)


@skip_on_windows
class TestPtyBridgeEnv:
    def test_cwd_is_respected(self, tmp_path):
        bridge = PtyBridge.spawn(
            ["/bin/sh", "-c", "pwd"],
            cwd=str(tmp_path),
        )
        try:
            output = _read_until(bridge, str(tmp_path).encode())
            assert str(tmp_path).encode() in output
        finally:
            bridge.close()


class TestPtyBridgeUnavailable:
    """Platform fallback semantics — PtyUnavailableError is importable and
    carries a user-readable message."""

    def test_error_carries_user_message(self):
        err = PtyUnavailableError("platform not supported")
        assert "platform" in str(err)

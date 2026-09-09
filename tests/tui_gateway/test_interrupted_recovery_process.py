"""Real SIGKILL/restart with a fake model and a disposable HERMES_HOME.

Deleting the marker deliberately injects the gap. This does NOT reproduce or
explain the production incident's missing marker.
"""

import json
import os
from pathlib import Path
import subprocess
import sys
import time
import pytest

pytestmark = pytest.mark.skipif(
    os.name == "nt", reason="controlled test uses POSIX signals"
)


from tui_gateway.turn_marker import (
    record_turn_start,
    read_turn_marker,
    claim_turn_recovery,
)


def test_recovery_claim_survives_other_client_and_releases_after_process_death(
    tmp_path,
):
    record_turn_start(tmp_path, "claim-test", "controlled task")
    code = """
import os, signal
from pathlib import Path
from tui_gateway.turn_marker import read_turn_marker, claim_turn_recovery
home = Path(os.environ['HERMES_HOME'])
assert claim_turn_recovery(home, 'claim-test', read_turn_marker(home, 'claim-test'))
(home / 'claimed').write_text('ready')
signal.pause()
"""
    process = subprocess.Popen(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[2],
        env={**os.environ, "HERMES_HOME": str(tmp_path)},
    )
    try:
        deadline = time.monotonic() + 10
        while (
            not (tmp_path / "claimed").exists()
            and process.poll() is None
            and time.monotonic() < deadline
        ):
            time.sleep(0.02)
        assert (tmp_path / "claimed").exists()
        assert (
            claim_turn_recovery(
                tmp_path, "claim-test", read_turn_marker(tmp_path, "claim-test")
            )
            is None
        )
    finally:
        process.kill()
        process.wait(timeout=10)
    assert claim_turn_recovery(
        tmp_path, "claim-test", read_turn_marker(tmp_path, "claim-test")
    )
    assert read_turn_marker(tmp_path, "claim-test")["attempts"] == 2


@pytest.mark.parametrize("operation", ["cancel", "release"])
def test_safety_writes_wait_for_cross_process_lock(tmp_path, operation):
    import threading
    from tui_gateway.turn_marker import clear_turn_marker, release_turn_recovery

    record_turn_start(tmp_path, "contended", "controlled task")
    token = claim_turn_recovery(tmp_path, "contended", read_turn_marker(tmp_path, "contended"))
    code = """
import fcntl, sys
with open(sys.argv[1], 'a+b') as handle:
    fcntl.flock(handle, fcntl.LOCK_EX)
    print('locked', flush=True)
    sys.stdin.readline()
"""
    holder = subprocess.Popen(
        [sys.executable, "-c", code, str(tmp_path / "desktop/interrupted_turns.lock")],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
    )
    finished = threading.Event()
    errors = []
    def write():
        try:
            if operation == "cancel":
                clear_turn_marker(tmp_path, "contended", reason="cancelled")
            else:
                release_turn_recovery(tmp_path, "contended", token)
        except Exception as exc:
            errors.append(exc)
        finally:
            finished.set()
    worker = threading.Thread(target=write)
    try:
        assert holder.stdout.readline().strip() == "locked"
        worker.start()
        assert not finished.wait(0.2), "safety write must not silently drop on contention"
    finally:
        holder.communicate("release\n", timeout=5)
        if worker.ident:
            worker.join(timeout=5)
    assert finished.is_set() and not errors
    marker = read_turn_marker(tmp_path, "contended")
    if operation == "cancel":
        assert marker is None
    else:
        assert marker and "claim" not in marker


WORKER = r"""
import json, os, signal, threading, types
from pathlib import Path
from hermes_state import SessionDB
from tui_gateway import server
home = Path(os.environ['HERMES_HOME'])
db = SessionDB(db_path=home / 'state.db')
server._get_db = lambda: db
server._emit = lambda *a, **kw: print(repr(a), flush=True)
for name in ('_wire_callbacks', '_sync_agent_model_with_config', '_register_session_cwd', '_tts_stream_begin', '_sync_session_key_after_compress'):
    setattr(server, name, lambda *a, **kw: None)
server._session_cwd = lambda *a: str(home)
server._get_usage = lambda *a: {}
if os.environ['PHASE'] == 'run':
    db.create_session('kill-test', source='desktop')
    def fake_model(message, **kw):
        db.append_message('kill-test', 'user', message)
        db.append_message('kill-test', 'assistant', '', tool_calls=[{'id':'call', 'type':'function', 'function':{'name':'terminal', 'arguments':'{}'}}])
        (home / 'effect').write_text('executed once')
        (home / 'ready').write_text('ready')
        signal.pause()
    agent = types.SimpleNamespace(session_id='kill-test', _session_db=db, run_conversation=fake_model, clear_interrupt=lambda: None)
    session = dict(agent=agent, session_key='kill-test', history=[], history_lock=threading.Lock(), history_version=0, running=True, cols=80, attached_images=[], show_reasoning=False, inflight_turn=None)
    server._run_prompt_submit('turn', 'runtime', session, 'perform controlled work')
    session['_run_thread'].join(timeout=60)
else:
    server._profile_home = lambda *a: None
    server._enable_gateway_prompts = lambda: None
    server._schedule_agent_build = lambda *a: None
    server._schedule_session_cap_enforcement = lambda: None
    server._default_session_cwd = lambda: str(home)
    response = server.handle_request({'id':'resume', 'method':'session.resume', 'params':{'session_id':'kill-test'}})
    (home / 'response.json').write_text(json.dumps(response))
    db.close()
"""


def test_killed_fake_model_missing_marker_resumes_manual_without_replaying_effect(
    tmp_path,
):
    env = {**os.environ, "HERMES_HOME": str(tmp_path), "PHASE": "run"}
    root = Path(__file__).resolve().parents[2]
    process = subprocess.Popen(
        [sys.executable, "-c", WORKER],
        cwd=root,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        deadline = time.monotonic() + 20
        while (
            not (tmp_path / "ready").exists()
            and process.poll() is None
            and time.monotonic() < deadline
        ):
            time.sleep(0.05)
        if not (tmp_path / "ready").exists():
            if process.poll() is None:
                process.kill()
            stdout, stderr = process.communicate(timeout=10)
            raise AssertionError(
                f"fake model did not reach kill point: {stdout}\n{stderr}"
            )
        marker = tmp_path / "desktop" / "interrupted_turns.json"
        assert marker.exists(), "real turn pipeline must have written its marker"
        marker.unlink()  # Fault injection, not a claimed causal reproduction.
        process.kill()
        process.communicate(timeout=10)
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=10)
    restarted = subprocess.run(
        [sys.executable, "-c", WORKER],
        cwd=root,
        env={**env, "PHASE": "resume"},
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert restarted.returncode == 0, restarted.stderr
    response = json.loads((tmp_path / "response.json").read_text())["result"]
    assert response["recovery"]["reason"] == "missing_marker"
    assert response["recovery"]["needs_manual_continue"]
    assert not response["running"]
    assert "auto_continue" not in response
    assert (tmp_path / "effect").read_text() == "executed once"

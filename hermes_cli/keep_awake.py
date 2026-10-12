"""Profile-scoped keep-awake control for browser/Desktop clients."""

from __future__ import annotations

import base64
import getpass
import json
import os
import re
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

from hermes_constants import get_hermes_home

_STATE_RELATIVE = Path("state") / "keep-awake.json"
_SUDOERS_PATH = Path("/private/etc/sudoers.d/hermes-keep-awake")
_PMSET_COMMAND_PREFIX = "/usr/bin/pmset -a disablesleep"
_LOCAL_USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
_LOCK = threading.RLock()
_CAFFEINATE_PROC: subprocess.Popen[bytes] | None = None


def _state_path() -> Path:
    return get_hermes_home() / _STATE_RELATIVE


def read_desired_keep_awake() -> bool:
    try:
        data = json.loads(_state_path().read_text(encoding="utf-8"))
    except Exception:
        return False
    return data.get("on") is True


def write_desired_keep_awake(on: bool) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"on": bool(on)}, indent=2), encoding="utf-8")


def _caffeinate_active() -> bool:
    global _CAFFEINATE_PROC
    proc = _CAFFEINATE_PROC
    if proc is None:
        return False
    if proc.poll() is None:
        return True
    _CAFFEINATE_PROC = None
    return False


def _start_caffeinate() -> None:
    global _CAFFEINATE_PROC
    if _caffeinate_active():
        return
    caffeinate = Path("/usr/bin/caffeinate")
    if not caffeinate.exists():
        return
    _CAFFEINATE_PROC = subprocess.Popen(  # noqa: S603 - fixed system binary + fixed args
        [str(caffeinate), "-dims"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _stop_caffeinate() -> None:
    global _CAFFEINATE_PROC
    proc = _CAFFEINATE_PROC
    _CAFFEINATE_PROC = None
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=2)


def parse_macos_sleep_disabled(output: str) -> bool:
    match = re.search(r"^\s*SleepDisabled\s+(\d+)", output, re.MULTILINE)
    return bool(match and match.group(1) == "1")


def _macos_sleep_disabled() -> bool:
    result = subprocess.run(  # noqa: S603 - fixed system binary + fixed args
        ["/usr/bin/pmset", "-g"],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return parse_macos_sleep_disabled(result.stdout)


def _authorization_rule(username: str) -> str:
    if not _LOCAL_USERNAME_PATTERN.match(username) or username.upper() == "ALL":
        raise RuntimeError("Cannot install local keep-awake authorization for this macOS username")
    return f"{username} ALL=(root) NOPASSWD: {_PMSET_COMMAND_PREFIX} 0, {_PMSET_COMMAND_PREFIX} 1\n"


def _install_macos_authorization() -> None:
    rule = _authorization_rule(getpass.getuser())
    encoded_rule = base64.b64encode(rule.encode("utf-8")).decode("ascii")
    sudoers_dir = str(_SUDOERS_PATH.parent)
    shell_script = "; ".join(
        [
            "set -eu",
            f"/bin/mkdir -p {sudoers_dir}",
            "tmp=$(/usr/bin/mktemp /private/etc/sudoers.d/.hermes-keep-awake.XXXXXX)",
            "trap '/bin/rm -f \"$tmp\"' EXIT HUP INT TERM",
            f"/usr/bin/printf %s {encoded_rule} | /usr/bin/base64 -D > \"$tmp\"",
            "/usr/sbin/chown root:wheel \"$tmp\"",
            "/bin/chmod 0440 \"$tmp\"",
            "/usr/sbin/visudo -cf \"$tmp\" >/dev/null",
            f"/bin/mv -f \"$tmp\" {_SUDOERS_PATH}",
        ]
    )
    osa = f'do shell script "/bin/sh -c " & quoted form of {json.dumps(shell_script)} with administrator privileges'
    subprocess.run(["/usr/bin/osascript", "-e", osa], check=True, capture_output=True, text=True, timeout=120)  # noqa: S603


def _needs_authorization(error: subprocess.CalledProcessError) -> bool:
    text = f"{error.stdout or ''}\n{error.stderr or ''}"
    return bool(re.search(r"password is required|not (?:allowed to execute|in the sudoers file)|may not run sudo", text, re.I))


def _set_macos_sleep_disabled(on: bool) -> None:
    args = ["/usr/bin/sudo", "-n", "/usr/bin/pmset", "-a", "disablesleep", "1" if on else "0"]
    try:
        subprocess.run(args, check=True, capture_output=True, text=True, timeout=30)  # noqa: S603
    except subprocess.CalledProcessError as exc:
        if _SUDOERS_PATH.exists() or not _needs_authorization(exc):
            raise
        _install_macos_authorization()
        subprocess.run(args, check=True, capture_output=True, text=True, timeout=30)  # noqa: S603


def _system_active() -> bool:
    caffeinated = _caffeinate_active()
    if sys.platform != "darwin":
        return caffeinated
    try:
        return caffeinated and _macos_sleep_disabled()
    except Exception:
        return False


def apply_keep_awake(on: bool) -> dict[str, Any]:
    """Apply and persist keep-awake for the current Hermes profile."""
    with _LOCK:
        if on:
            _start_caffeinate()
            try:
                if sys.platform == "darwin":
                    _set_macos_sleep_disabled(True)
            except Exception:
                _stop_caffeinate()
                raise
        else:
            try:
                if sys.platform == "darwin":
                    _set_macos_sleep_disabled(False)
            finally:
                _stop_caffeinate()

        write_desired_keep_awake(on)
        active = _system_active()
        return {"ok": active is bool(on), "on": active, "desired": bool(on)}


def get_keep_awake_state() -> dict[str, Any]:
    """Return state for the current Hermes profile, re-arming desired-on state."""
    with _LOCK:
        desired = read_desired_keep_awake()
        if desired and not _system_active():
            return apply_keep_awake(True)
        active = _system_active()
        if not desired and active:
            # Keep the selected profile's UI honest: the profile is off even if a
            # foreign process currently has a power assertion.
            active = False
        return {"ok": True, "on": active, "desired": desired}

"""Authenticated, versioned backend capability manifest."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

import httpx
from fastapi import APIRouter

from hermes_constants import get_hermes_home

router = APIRouter()
MANIFEST_VERSION = 1


def _files_available() -> bool:
    home = get_hermes_home()
    home.mkdir(parents=True, exist_ok=True)
    return home.is_dir() and os.access(home, os.R_OK | os.W_OK | os.X_OK)


def _git_available() -> bool:
    executable = shutil.which("git")
    if not executable:
        return False
    result = subprocess.run(
        [executable, "--version"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=2,
        check=False,
    )
    return result.returncode == 0


def _persistent_terminal_available() -> bool:
    endpoint_path = get_hermes_home() / "terminal-host" / "runtime" / "endpoint.json"
    endpoint = json.loads(endpoint_path.read_text(encoding="utf-8"))
    port = endpoint.get("port")
    token = endpoint.get("token")
    epoch = endpoint.get("epoch")
    if not isinstance(port, int) or not 0 < port < 65536 or not token or epoch is None:
        return False
    # Prove the authenticated terminal-host protocol is live; a listening
    # unrelated process on a stale endpoint port is not capability evidence.
    response = httpx.post(
        f"http://127.0.0.1:{port}/rpc",
        headers={"Authorization": f"Bearer {token}"},
        json={"method": "status", "params": {}, "epoch": epoch},
        timeout=0.5,
        trust_env=False,
    )
    payload = response.json()
    return response.is_success and not payload.get("error") and "result" in payload


def _lifecycle_available() -> bool:
    # Lifecycle routes execute this interpreter against the installed gateway
    # package. Probe both rather than inferring client surface from process env.
    return bool(sys.executable) and (Path(__file__).parents[2] / "gateway" / "run.py").is_file()


def _closed_probe(probe: Callable[[], bool]) -> bool:
    try:
        return probe() is True
    except Exception:
        return False


def probe_capabilities() -> dict[str, object]:
    return {
        "version": MANIFEST_VERSION,
        "capabilities": {
            "files": _closed_probe(_files_available),
            "git": _closed_probe(_git_available),
            "persistentTerminal": _closed_probe(_persistent_terminal_available),
            "lifecycle": _closed_probe(_lifecycle_available),
        },
    }


@router.get("/api/capabilities")
async def get_capabilities():
    return probe_capabilities()

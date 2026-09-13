"""Authenticated backend proxy to an independently installed local terminal host."""
import asyncio
import json
import os
from pathlib import Path

import httpx
from fastapi import WebSocket, WebSocketDisconnect


async def proxy_terminal_host(ws: WebSocket, home: Path, profile: str, profile_home: Path) -> None:
    # The endpoint credential is machine-local; it is never returned to Desktop.
    try:
        endpoint = json.loads((home / "terminal-host" / "runtime" / "endpoint.json").read_text())
        port = endpoint["port"]
        if not isinstance(port, int) or not 0 < port < 65536:
            raise ValueError("Invalid endpoint")
    except (OSError, ValueError, KeyError):
        await ws.close(code=4404, reason="Install and start hermes-terminal-host on this backend")
        return

    scope = f"profile/{profile}"
    async with httpx.AsyncClient(trust_env=False, timeout=10) as client:
        async def request(method, params):
            response = await client.post(
                f"http://127.0.0.1:{port}/rpc",
                headers={"Authorization": f"Bearer {endpoint['token']}"},
                json={"method": method, "params": params, "epoch": endpoint["epoch"]},
            )
            value = response.json()
            if response.is_error or value.get("error"):
                raise ValueError(value.get("error", "HOST_UNAVAILABLE"))
            return value["result"]

        try:
            await request("status", {})
        except (httpx.HTTPError, ValueError):
            await ws.close(code=4404, reason="Persistent terminal host unavailable")
            return
        await ws.accept()
        await ws.send_json({"type": "ready", "protocol": 2, "epoch": endpoint["epoch"], "scope": scope})
        leases = {}
        try:
            while True:
                text = await ws.receive_text()
                if len(text.encode()) > 128 * 1024:
                    await ws.close(code=1009)
                    break
                frame = json.loads(text)
                method, params = frame.get("method"), frame.get("params", {})
                try:
                    if method not in {"create", "attach", "read", "input", "resize", "detach", "terminate"} or not isinstance(params, dict):
                        raise ValueError("INVALID_METHOD")
                    if params.get("scope") != scope:
                        raise ValueError("OWNER_MISMATCH")
                    if params.get("epoch", endpoint["epoch"]) != endpoint["epoch"]:
                        raise ValueError("HOST_LOST")
                    if method == "create":
                        from tools.environments.local import build_subprocess_env
                        shell = (os.environ.get("COMSPEC") or "cmd.exe") if os.name == "nt" else (os.environ.get("SHELL") or "/bin/sh")
                        cwd = params.get("cwd") or str(Path.home())
                        if not os.path.isdir(cwd):
                            raise ValueError("INVALID_CWD")
                        params = {"scope": scope, "requestId": params.get("requestId"),
                                  "file": shell, "args": [] if os.name == "nt" else ["-l"],
                                  "cwd": cwd, "cols": params.get("cols", 80), "rows": params.get("rows", 24),
                                  "env": build_subprocess_env(extra={"HERMES_HOME": str(profile_home), "TERM": "xterm-256color"})}
                    result = await request(method, params)
                    if method == "attach":
                        leases[params["terminalId"]] = result["identity"]
                    if method in {"detach", "terminate"}:
                        leases.pop(params["terminalId"], None)
                    await ws.send_json({"id": frame.get("id"), "result": result})
                except (httpx.HTTPError, ValueError, KeyError) as error:
                    # Host protocol errors are short codes, not HTTP dumps containing credentials.
                    code = str(error)
                    if code not in {"GAP", "HOST_LOST", "OWNER_MISMATCH", "NOT_FOUND", "STALE_WRITER", "INVALID_CWD", "INVALID_METHOD", "SESSION_LIMIT", "CREATE_LIMIT"}:
                        code = "TERMINAL_REQUEST_FAILED"
                    await ws.send_json({"id": frame.get("id"), "error": code})
        except (WebSocketDisconnect, ValueError):
            pass
        finally:
            for identity in leases.values():
                try:
                    await asyncio.wait_for(request("detach", identity), 2)
                except (httpx.HTTPError, ValueError, asyncio.TimeoutError):
                    pass

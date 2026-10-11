"""Socket-owned, ephemeral remote Chromium. No browser cookies or DOM enter Hermes.

Each authenticated socket owns one worker/context; there is no attach identifier
that another client can guess. Disconnect, idle expiry and backend death reap it.
"""
import asyncio
import anyio
import json
import math
import os
import signal
import time
from pathlib import Path
from urllib.parse import urlsplit

MAX_SESSIONS = 4
IDLE_SECONDS = 300
MAX_LIFETIME_SECONDS = 3600
_active = set()


def validate_command(value):
    if not isinstance(value, dict):
        raise ValueError("INVALID_COMMAND")
    kind = value.get("type")
    out = {"type": kind}
    if kind == "navigate":
        url = value.get("url")
        if not isinstance(url, str) or len(url) > 8192 or any(ord(c) < 33 for c in url):
            raise ValueError("INVALID_URL")
        parts = urlsplit(url)
        if url != "about:blank" and (parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password):
            raise ValueError("INVALID_URL")
        out["url"] = url
    elif kind in {"back", "forward", "reload", "stop", "ack"}:
        pass
    elif kind == "type":
        text = value.get("text")
        if not isinstance(text, str) or len(text) > 16384:
            raise ValueError("INVALID_TEXT")
        out["text"] = text
    elif kind == "key":
        key = value.get("key")
        if not isinstance(key, str) or len(key) > 80 or not key:
            raise ValueError("INVALID_KEY")
        out["key"] = key
    elif kind in {"click", "scroll", "resize"}:
        fields = {"click": ("x", "y"), "scroll": ("deltaX", "deltaY"), "resize": ("width", "height")}[kind]
        for field in fields:
            number = value.get(field)
            if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number):
                raise ValueError("INVALID_COORDINATE")
            lo, hi = (160, 1920) if kind == "resize" else ((-3000, 3000) if kind == "scroll" else (0, 1920))
            if not lo <= number <= hi:
                raise ValueError("INVALID_COORDINATE")
            out[field] = int(number) if kind == "resize" else number
        if kind == "click":
            button = value.get("button", "left")
            if button not in {"left", "middle", "right"}:
                raise ValueError("INVALID_BUTTON")
            out["button"] = button
    else:
        raise ValueError("INVALID_COMMAND")
    return out


async def close_worker(process):
    if process.stdin:
        process.stdin.close()
    if process.returncode is None:
        try:
            process.terminate()  # worker SIGTERM closes Chromium before exiting
        except ProcessLookupError:
            pass
    try:
        await asyncio.wait_for(process.wait(), 3)
    except asyncio.TimeoutError:
        # Chromium descendants share the helper's process group on POSIX.
        if os.name != "nt":
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            process.kill()
        await process.wait()


async def serve_remote_browser(ws):
    if len(_active) >= MAX_SESSIONS:
        await ws.close(code=4429, reason="Remote browser session limit")
        return
    lease = object()
    _active.add(lease)  # no await between capacity check and reservation
    process = None
    tasks = []
    try:
        from hermes_constants import find_node_executable
        node = await asyncio.to_thread(find_node_executable, "node")
        if not node:
            await ws.close(code=4404, reason="Remote browser requires managed Node and playwright")
            return
        script = Path(__file__).with_name("remote_browser_worker.mjs")
        # Never inherit backend API keys into the untrusted browser process.
        env = {key: val for key, val in os.environ.items() if key in {
            "PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL",
            "SYSTEMROOT", "PLAYWRIGHT_BROWSERS_PATH",
        }}
        process = await asyncio.create_subprocess_exec(
            node, str(script), stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            limit=8 * 1024 * 1024, env=env, start_new_session=os.name != "nt",
        )
        ready = await asyncio.wait_for(process.stdout.readline(), 30)
        if not ready or json.loads(ready).get("type") != "ready":
            await ws.close(code=4404, reason="Remote Chromium unavailable; install playwright and sandboxed Chromium")
            return
        await ws.accept()
        await ws.send_text(ready.decode())

        async def inputs():
            from fastapi import WebSocketDisconnect
            try:
                last_activity = time.monotonic()
                rate_start, rate_count = last_activity, 0
                while True:
                    remaining = IDLE_SECONDS - (time.monotonic() - last_activity)
                    if remaining <= 0:
                        return
                    text = await asyncio.wait_for(ws.receive_text(), remaining)
                    now = time.monotonic()
                    if now - rate_start >= 1:
                        rate_start, rate_count = now, 0
                    rate_count += 1
                    if rate_count > 120:
                        await ws.close(code=4429, reason="Browser input rate limit")
                        return
                    if len(text) > 32768:
                        await ws.close(code=1009)
                        return
                    try:
                        command = validate_command(json.loads(text))
                    except (ValueError, TypeError):
                        await ws.send_json({"type": "error", "error": "Invalid browser command"})
                        continue
                    if command["type"] != "ack":
                        last_activity = now
                    process.stdin.write((json.dumps(command) + "\n").encode())
                    await asyncio.wait_for(process.stdin.drain(), 5)
            except WebSocketDisconnect:
                pass

        async def frames():
            while True:
                line = await process.stdout.readline()
                if not line:
                    return
                await asyncio.wait_for(ws.send_text(line.decode()), 5)

        tasks = [asyncio.create_task(inputs()), asyncio.create_task(frames())]
        done, _ = await asyncio.wait(tasks, timeout=MAX_LIFETIME_SECONDS, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except (OSError, ValueError, RuntimeError, asyncio.TimeoutError, ConnectionError):
        pass
    finally:
        # Starlette cancels the route's AnyIO scope on disconnect. Cleanup must
        # complete inside that cancellation, not leak a Chromium or its lease.
        with anyio.CancelScope(shield=True):
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            try:
                if process:
                    await close_worker(process)
            finally:
                _active.discard(lease)
            try:
                await ws.close(code=1000, reason="Remote browser closed")
            except RuntimeError:
                pass

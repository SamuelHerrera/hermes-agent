"""Real Chromium test; run with pytest (skips when Chromium is not installed)."""
import base64
import io
import json
from pathlib import Path
import queue
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from PIL import Image


def test_real_browser_worker():
    root = Path(__file__).resolve().parents[2]
    worker = root / 'hermes_cli' / 'remote_browser_worker.mjs'
    node = shutil.which('node')
    if not node:
        pytest.skip('Node unavailable')
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            html = b'''<!doctype html><title>fixture</title><style>body{margin:0}input,button{display:block;width:200px;height:40px}div{height:4000px}</style>
            <input oninput="document.title='typed:'+this.value">
            <button onclick="document.title='clicked'">Click</button>
            <a href="/second">Next</a><div></div>
            <script>window.onscroll=()=>document.title='scroll:'+scrollY</script>'''
            if self.path == '/second':
                html = b'<title>second</title><p>Second page</p>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(html)
        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    process = subprocess.Popen([node, str(worker)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    output = queue.Queue()
    def read():
        for line in process.stdout:
            output.put(json.loads(line))
        output.put({'type': 'eof'})
    threading.Thread(target=read, daemon=True).start()
    def send(command):
        process.stdin.write(json.dumps(command) + '\n')
        process.stdin.flush()
    def until(predicate):
        for _ in range(120):
            item = output.get(timeout=25)
            if item['type'] == 'frame':
                send({'type': 'ack'})
            assert item['type'] not in {'eof', 'error', 'unavailable'}, item
            if predicate(item):
                return item
        raise AssertionError('Expected frame/state did not arrive')
    def state(title):
        return until(lambda item: item['type'] in {'frame', 'state'} and item.get('title') == title)
    try:
        ready = output.get(timeout=35)
        if ready['type'] == 'unavailable':
            pytest.skip('Install sandboxed Chromium: npx playwright install chromium')
        assert ready['type'] == 'ready', ready
        base = f'http://127.0.0.1:{server.server_port}'
        send({'type': 'navigate', 'url': base})
        state('fixture')
        frame = until(lambda item: item['type'] == 'frame' and item.get('title') == 'fixture')
        assert Image.open(io.BytesIO(base64.b64decode(frame['image']))).size == (1024, 768)
        send({'type': 'click', 'x': 80, 'y': 20, 'button': 'left'})
        send({'type': 'type', 'text': 'hello'})
        state('typed:hello')
        send({'type': 'key', 'key': 'Backspace'})
        state('typed:hell')
        send({'type': 'click', 'x': 80, 'y': 60, 'button': 'left'})
        state('clicked')
        send({'type': 'resize', 'width': 390, 'height': 640})
        frame = until(lambda item: item['type'] == 'frame' and item['width'] == 390)
        assert Image.open(io.BytesIO(base64.b64decode(frame['image']))).size == (390, 640)
        send({'type': 'scroll', 'deltaX': 0, 'deltaY': 400})
        until(lambda item: item.get('title', '').startswith('scroll:') and item.get('title') != 'scroll:0')
        send({'type': 'navigate', 'url': base + '/second'})
        state('second')
        send({'type': 'back'})
        until(lambda item: item.get('url') == base + '/')
        send({'type': 'forward'})
        state('second')
        send({'type': 'reload'})
        state('second')
        assert requests.count('/second') >= 2
        # A hostile page cannot escape into a file: screenshot.
        send({'type': 'navigate', 'url': 'file:///etc/passwd'})
        until_error = output.get(timeout=5)
        while until_error['type'] != 'error':
            if until_error['type'] == 'frame': send({'type': 'ack'})
            until_error = output.get(timeout=5)
        assert 'file:' not in until_error.get('url', '')
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=10)
        server.shutdown()
        server.server_close()
    assert process.returncode == 0


def test_real_websocket_proxy_disconnect():
    """A real socket, proxy, worker and Chromium; no transport or browser mocks."""
    import asyncio
    import importlib.util
    import socket
    import psutil
    import uvicorn
    import websockets
    from fastapi import FastAPI, WebSocket

    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location('browser_proxy_under_test', root / 'hermes_cli' / 'remote_browser.py')
    proxy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(proxy)
    requests = []
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b'<title>proxy fixture</title><h1>Rendered on backend</h1>')
        def log_message(self, *args):
            pass
    fixture = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=fixture.serve_forever, daemon=True).start()
    app = FastAPI()
    @app.websocket('/browser')
    async def browser(ws: WebSocket):
        await proxy.serve_remote_browser(ws)

    async def run():
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, log_level='error', lifespan='off'))
        serving = asyncio.create_task(server.serve(sockets=[listener]))
        before = {child.pid for child in psutil.Process().children(recursive=True)}
        try:
            async with asyncio.timeout(10):
                while not server.started:
                    await asyncio.sleep(.01)
            try:
                async with websockets.connect(f'ws://127.0.0.1:{port}/browser', max_size=8*1024*1024, open_timeout=35) as ws:
                    assert json.loads(await asyncio.wait_for(ws.recv(), 35))['type'] == 'ready'
                    assert len(proxy._active) == 1
                    await ws.send(json.dumps({'type': 'navigate', 'url': f'http://127.0.0.1:{fixture.server_port}/backend-only'}))
                    async with asyncio.timeout(30):
                        while True:
                            frame = json.loads(await ws.recv())
                            if frame['type'] == 'frame':
                                await ws.send(json.dumps({'type': 'ack'}))
                                if frame.get('title') == 'proxy fixture':
                                    assert Image.open(io.BytesIO(base64.b64decode(frame['image']))).format == 'JPEG'
                                    break
                    assert '/backend-only' in requests
            except websockets.exceptions.InvalidStatus as error:
                pytest.skip(f'Sandboxed Chromium unavailable: {error}')
            async with asyncio.timeout(10):
                while proxy._active:
                    await asyncio.sleep(.02)
            remaining = [child for child in psutil.Process().children(recursive=True) if child.pid not in before and child.is_running() and child.status() != psutil.STATUS_ZOMBIE]
            assert not remaining, [(child.pid, child.name()) for child in remaining]
        finally:
            server.should_exit = True
            await serving
            listener.close()
    try:
        asyncio.run(run())
    finally:
        fixture.shutdown()
        fixture.server_close()

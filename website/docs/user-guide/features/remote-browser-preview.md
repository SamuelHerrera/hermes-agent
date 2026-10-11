# Remote browser preview tabs

In the browser/PWA Desktop, URL preview tabs render an isolated Chromium running
on the connected Hermes backend. The phone receives JPEG frames and sends input
through `/api/remote-browser`; it does not fetch the website itself. Go, Back,
Forward, Reload, Stop, clicks, scrolling, typing and keyboard shortcuts act on
that backend browser. On phones, use the **Keyboard** button to type into the
focused page field. Electron continues to use its native webview.

Explicit external links elsewhere in Hermes remain browser-owned: they open a
normal client browser tab, not an OS window on the backend.

## Backend runtime requirements

For a source-checkout deployment:

1. Install the root optional npm dependency, pinned in `package-lock.json`:
   `npm install --workspaces=false --include=optional` (Playwright 1.58.2).
   No Python Playwright dependency or globally installed npm package is needed.
2. Provide Node 22.22.0 or later through Hermes' managed Node installation or
   the backend service's PATH. The backend uses `find_node_executable`, not a
   shell command or a guessed Node path. A login shell's mise/nvm PATH does not
   imply the systemd service can find Node; verify with the service environment.
3. On Linux, the helper uses `/usr/bin/chromium` when installed. Otherwise,
   install the browser for the **service user** with
   `./node_modules/.bin/playwright install chromium` and the browser's required
   OS libraries. The service must be able to run Chromium with its sandbox
   enabled. Running as root or on a kernel which disables the required sandbox
   fails closed; there is no `--no-sandbox` fallback.
4. Build the PWA with `npm run build:browser --workspace apps/desktop`, then
   restart the backend using the deployment's normal procedure. Reverse proxies
   must permit the existing authenticated WebSocket path and the new
   `/api/remote-browser` path under the same prefix.

If these dependencies are unavailable, the tab shows a connection error with a
Reconnect button. It never silently hands Go to an OS browser.

## Isolation and limits

- Each authenticated socket owns one ephemeral browser/context. There is no
  session identifier or attach API that another client can guess. Cookies,
  logins and history are not shared with agent browser tools, Electron or other
  remote tabs, and are discarded on disconnect/reconnect.
- The route uses the existing single-use WebSocket ticket/token, host/origin,
  peer and profile-validation boundaries, before spawning a process. Backend
  API keys are excluded from the worker environment.
- Only HTTP(S) URLs and `about:blank` are accepted, without embedded credentials.
  Page requests for other schemes are aborted. Website HTML/JavaScript is never
  proxied into the privileged Hermes origin; only raster images and plain-text
  metadata cross the boundary. Downloads and service workers are disabled;
  permissions are not granted. Popups are redirected into the owned viewport
  and extra pages are closed.
- Per backend process: four concurrent sockets; viewport dimensions 160–1920;
  at most four frames/second with acknowledgement backpressure; command/text
  size and input-rate limits; five-minute input-idle timeout (frame ACKs do not
  keep a session alive); one-hour maximum lifetime.
- Disconnect, startup failure, timeouts and cancellation close Chromium, reap
  the helper and release capacity. Switching backend/profile closes the old
  socket and mints a fresh credential.

This is a raster viewport, not a local browser DOM. Website text is not locally
selectable; audio/video streaming, native download dialogs, browser extensions,
DevTools and persistent logins are not provided by this transport.

## Verification

Focused backend tests:

```
python -m pytest tests/hermes_cli/test_remote_browser.py tests/hermes_cli/test_remote_browser_ws.py
```

Real integration tests (requires the runtime above):

```
python -m pytest tests/hermes_cli/test_remote_browser_integration.py -v
```

The integration suite serves a disposable HTTP fixture, verifies actual
backend-side requests, JPEG decoding, input/navigation/resize, and a real
WebSocket proxy. It checks that disconnect leaves no Chromium/helper processes.
It skips when the browser is not installed; a skipped integration test is not
proof that a deployment can run Chromium.

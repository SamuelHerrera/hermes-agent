# Hermes Chrome Bridge MCP Server

A standalone local [Model Context Protocol](https://modelcontextprotocol.io/) server, authenticated Chrome native-messaging host, and Manifest V3 extension. The MCP server owns a private Unix-socket broker; Chrome starts the native host, which authenticates to that broker and forwards bounded requests and responses.

The extension connects only after the user clicks **Connect** in its popup. That opt-in is stored locally so the service worker can reconnect with bounded backoff after a restart or native-host disconnect. **Disconnect** revokes the stored opt-in and hides all control indicators.

## Tools

- Discovery: `chrome_bridge_status`, `chrome_bridge_tabs`, `chrome_bridge_select_tab`
- Page state: `chrome_bridge_snapshot`, `chrome_bridge_query`
- Tabs: `chrome_bridge_open`, `chrome_bridge_navigate`, `chrome_bridge_focus`, `chrome_bridge_close`
- User-like actions: `chrome_bridge_click`, `chrome_bridge_type`, `chrome_bridge_key`, `chrome_bridge_scroll`, `chrome_bridge_hover`
- Guarded diagnostics: `chrome_bridge_eval`, `chrome_bridge_console`, `chrome_bridge_screenshot`

All page tools require an authenticated, explicitly opted-in host and a controllable public HTTP(S) tab. Private-network, local, browser-internal, Chrome Web Store, and sensitive-field paths fail closed. JavaScript evaluation is blocked whenever a password, payment, or one-time-code field is present and is advertised as destructive/open-world so Hermes approval policy applies. Tool output is bounded and credential-shaped strings are redacted.

## Development

From the repository root:

```sh
npm install
npm run check --workspace @hermes/chrome-bridge
npm start --workspace @hermes/chrome-bridge -- --hermes-home /absolute/path/to/profile-home
```

`check` type-checks and lints `src/**`, `native/**`, and `extension/**`; builds `dist/server.js` without moving the MCP entrypoint; builds the native host under `dist/native/`; creates the unpacked extension under `dist/extension/`; and runs the executable lifecycle, artifact, framing, broker, fake-Chrome, installer, and MCP integration tests.

Both MCP and Chrome native messaging reserve stdout for protocol frames. Diagnostics go to stderr and never include raw page or user content.

## Build and load the extension for development

Build the package, then load the generated directory rather than the TypeScript source:

```sh
npm run build --workspace @hermes/chrome-bridge
```

1. Open `chrome://extensions` in a development Chrome profile.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select `packages/hermes-chrome-bridge/dist/extension`.
4. The committed public manifest key gives this unpacked build the stable extension ID `mdeahbanbmncnmkjkklglmdflkcclckg`.
5. Open the extension popup and click **Connect** to opt in. Click **Disconnect** to revoke opt-in and stop reconnecting.

The manifest uses only `nativeMessaging` and `storage`. `<all_urls>` allows the isolated content script to inspect and act on ordinary public web pages and permits `captureVisibleTab`; the bridge does not request `debugger`, open a remote-debug port, or connect to a remote service. A static main-world script captures bounded console entries and services guarded evaluation requests. The isolated bridge validates every message and treats all page results as untrusted data. During automation, a shadow-DOM pill reading **Hermes is controlling Chrome** and a gold cursor marker remain visibly on the page, then dim after inactivity.

## Install the native host

The setup command copies the built extension to a stable profile-owned path and installs the native host for the committed extension ID:

```sh
npm run build --workspace @hermes/chrome-bridge
node packages/hermes-chrome-bridge/dist/native/setup.js install \
  --hermes-home /absolute/path/to/the/active/hermes/profile
```

Load the `extensionDirectory` printed by that command in `chrome://extensions`, open the extension popup, and click **Connect**. Check both installation and live native-host connectivity with:

```sh
node packages/hermes-chrome-bridge/dist/native/setup.js check \
  --hermes-home /absolute/path/to/the/active/hermes/profile
```

On macOS this writes the manifest to:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.nous.hermes_chrome_bridge.json
```

Linux uses the corresponding Chrome user manifest directory under `~/.config/google-chrome/NativeMessagingHosts/`. Windows fails closed until a signed executable launcher is available. Automated tests and package smoke checks pass `--manifest-directory /absolute/temp/path` to keep every write out of real Chrome user directories.

The installer creates a private runtime directory under the selected Hermes home. The runtime directory is mode `0700`; its random authentication token, config, and connectivity-only status are mode `0600`. The executable wrapper contains absolute paths to the current Node executable, built host, and runtime config, and does not depend on `PATH` or an environment-selected Node.

Chrome has one global native host name, `com.nous.hermes_chrome_bridge`. The selected active profile owns that registration. Re-run the installer with another profile's explicit `--hermes-home` to select that profile instead.

## MCP host configuration

Hermes users should install the approved catalog entry:

```sh
hermes mcp install hermes-chrome-bridge
hermes mcp test hermes-chrome-bridge
```

The install output prints the profile-aware setup command and unpacked-extension path. `hermes mcp test` distinguishes MCP transport connectivity from the extension/native-host connection and reports the latter as connected or disconnected.

Other MCP hosts can configure the built server directly with the same explicit profile home:

```json
{
  "command": "/absolute/path/to/node",
  "args": [
    "/absolute/path/to/@hermes/chrome-bridge/dist/server.js",
    "--hermes-home",
    "/absolute/path/to/the/active/hermes/profile"
  ]
}
```

The implementation can internally fall back to the existing Hermes home resolution (`HERMES_HOME`, then `~/.hermes`), but setup should pass `--hermes-home` so profile ownership is unambiguous.

## Protocol notes

- Native messaging uses Chrome's 4-byte native-endian length prefix and strict UTF-8 JSON objects.
- Browser-to-host messages are capped at 64 MiB; host-to-browser messages are capped at 1 MiB.
- Broker IPC is capped NDJSON over a private POSIX Unix socket.
- The native host must authenticate protocol version 1, the random token, and the exact configured `chrome-extension://<id>/` origin.
- Only one authenticated host may connect. Requests have IDs, bounded pending concurrency, and timeouts; stale sockets are checked and cleaned safely.
- Status files contain connectivity, protocol version, and timestamps only.

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

## Simultaneous Chrome profiles

Load the extension in each Chrome profile and click **Connect** independently.
The popup accepts a public nickname such as “Work” or “Personal”; do not put
account details or secrets in it. Each extension installation stores a random,
non-secret `connectionId` in **local** (not synced) Chrome storage. It survives
Disconnect, reconnect and browser restarts. Clearing extension storage creates a
new identity. Labels can repeat; routing never uses a label as an identifier.

1. Call `chrome_bridge_status` with `{}` to discover all connected profiles.
2. Pass `connectionId` to `chrome_bridge_tabs`, `chrome_bridge_open`, or any
   other tool to target that profile explicitly.
3. Use returned opaque `tabId` strings for subsequent commands. They namespace
   the native tab ID by both profile identity and connection incarnation. They
   also select the connection without a separate `connectionId` argument.
4. After reconnect, re-list that profile's tabs. Old tab IDs fail with
   `STALE_TAB_ID`; conflicting connection/tab targets fail with
   `CONNECTION_MISMATCH`. No request is retried on another profile.

Untargeted commands and legacy integer tab IDs still work during an unchanged
single-connection MCP session. Once multiple connections have been present, or
the initially connected profile has disconnected and reconnected or been replaced, explicit targeting is required for
the rest of that broker session—even if only one profile remains. An integer
tab ID with an explicit connection stays supported, but opaque IDs are preferred
because they also detect reconnects. Selected tabs and pending requests belong
to their own connection. Disconnecting one profile never disconnects its peers.

Duplicate live identities fail closed rather than replacing an existing host.
If you copied an entire Chrome profile directory, clear the bridge's extension
storage in the copy and opt in again to generate its own identity.

Upgrade the extension, native host and MCP server together. Older authenticated
native hosts without identity metadata get an ephemeral public ID; reconnect
cannot preserve that ID. MCP status is the authoritative live connection list.

### Live verification (not mocks)

After building, from the repository root with Playwright's Chromium installed:

```sh
node packages/hermes-chrome-bridge/scripts/multi-profile-smoke.mjs /absolute/evidence/directory
```

This opt-in smoke launches two disposable Chrome-for-Testing profiles, clicks
their actual extension popup controls, and exercises the stdio MCP → broker →
native host → extension → public page path concurrently. It tests target
ambiguity, selected-tab isolation, redaction, guarded eval and independent
Disconnect/reconnect. Browser data, manifests and broker config stay temporary;
only the public extension manifest key is changed in the test copy to prevent
accidental authorization by your regular native host. Extension code is unchanged.
It leaves screenshots and a JSON report, then closes the test browsers.

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

The manifest uses `nativeMessaging`, `scripting`, and `storage`. `<all_urls>` allows the isolated content script to inspect and act on ordinary public web pages and permits `captureVisibleTab`; the bridge does not request `debugger`, open a remote-debug port, or connect to a remote service. Guarded evaluation and console access run through extension-owned `chrome.scripting.executeScript` calls instead of page-observable response events. The isolated bridge validates every message and treats all page results as untrusted data. During automation, a shadow-DOM pill reading **Hermes is controlling Chrome** and a gold cursor marker remain visibly on the page, then dim after inactivity.

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

Chrome has one native host name, `com.nous.hermes_chrome_bridge`. One **Hermes** home owns that registration and its MCP broker; many **Chrome** profiles can connect to it simultaneously. Re-running the installer with another `--hermes-home` changes the owning Hermes home, not which Chrome profile is controllable.

## MCP host configuration

Hermes users should install the approved catalog entry:

```sh
hermes mcp install hermes-chrome-bridge
hermes mcp test hermes-chrome-bridge
```

The install command configures the MCP server, installs the extension assets into
the active profile's `<HERMES_HOME>/chrome-bridge/extension`, and registers the
Chrome native-messaging host. The user still must load/enable the extension in
Chrome and click **Connect**. `hermes mcp test` distinguishes MCP transport
connectivity from the extension/native-host connection and reports the latter as
connected or disconnected.

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
- Before authentication, the updated extension sends the native host a strict `bridge.identity` message containing protocol version 1, its public `connectionId` and bounded label. This metadata is not authentication: the host still validates the Chrome origin and authenticates with the private broker token.
- Each authenticated connection owns its socket, pending requests and timeout budget. Request IDs are unique across broker incarnations; responses from another socket cannot settle them. Duplicate active identities are rejected, never silently replaced.
- The broker alone writes aggregate status, including public identities/labels and connectivity timestamps, never tokens, account names or Chrome profile paths. One native host exiting cannot overwrite another profile's connected status. Read live MCP status rather than relying on a file after an unclean process exit.

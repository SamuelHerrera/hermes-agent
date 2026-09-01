# Hermes Chrome Bridge MCP Server

A standalone local [Model Context Protocol](https://modelcontextprotocol.io/) server plus an authenticated Chrome native-messaging host. The MCP server owns a private Unix-socket broker; Chrome starts the native host, which authenticates to that broker and forwards extension requests and responses.

The MV3 extension is not included yet. Task 3 will add it; the native host and `FakeChromeProcess` harness are ready for extension integration tests.

## Tools

- `chrome_bridge_status` — reports local connectivity even when Chrome is disconnected.
- `chrome_bridge_tabs` — routes through the authenticated native host.
- `chrome_bridge_snapshot` — routes through the authenticated native host.

When no authenticated host is connected, routed tools return the deterministic `BRIDGE_DISCONNECTED` error.

## Development

From the repository root:

```sh
npm install
npm run check --workspace @hermes/chrome-bridge
npm start --workspace @hermes/chrome-bridge -- --hermes-home /absolute/path/to/profile-home
```

`check` type-checks and lints both `src/**` and `native/**`, builds `dist/server.js` without moving the MCP entrypoint, builds the native host under `dist/native/`, and runs the framing, broker, fake-Chrome, installer, and MCP integration tests.

Both MCP and Chrome native messaging reserve stdout for protocol frames. Diagnostics go to stderr and never include raw page or user content.

## Install the native host

Build first, then provide the unpacked extension's exact 32-character Chrome extension ID and the explicitly resolved Hermes profile home:

```sh
npm run build --workspace @hermes/chrome-bridge
node packages/hermes-chrome-bridge/dist/native/install-host.js \
  --extension-id abcdefghijklmnopabcdefghijklmnop \
  --hermes-home /absolute/path/to/the/active/hermes/profile
```

On macOS this writes the manifest to:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.nous.hermes_chrome_bridge.json
```

Linux uses the corresponding Chrome user manifest directory under `~/.config/google-chrome/NativeMessagingHosts/`. Windows fails closed until a signed executable launcher is available. Automated tests and package smoke checks can add `--manifest-directory /absolute/temp/path` to keep every write out of real Chrome user directories.

The installer creates a private runtime directory under the selected Hermes home. The runtime directory is mode `0700`; its random authentication token, config, and connectivity-only status are mode `0600`. The executable wrapper contains absolute paths to the current Node executable, built host, and runtime config, and does not depend on `PATH` or an environment-selected Node.

Chrome has one global native host name, `com.nous.hermes_chrome_bridge`. The selected active profile owns that registration. Re-run the installer with another profile's explicit `--hermes-home` to select that profile instead.

## MCP host configuration

After installation, configure an MCP host with the same explicit profile home:

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

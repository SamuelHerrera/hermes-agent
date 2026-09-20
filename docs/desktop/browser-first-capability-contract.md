# Browser-first desktop capability contract

Hermes Desktop renderer code targets a `HermesHost`, not Electron itself. The host is the adapter for the **connected backend host**: the machine or service that owns the selected Hermes backend connection. It is not necessarily the machine running the browser, and it must not be inferred from backend process environment variables.

## Contract

`HermesHost` exposes only the boot-critical waist:

- `kind`: `browser` or `electron`
- explicit `capabilities`
- `getConnection(profile)`
- `getGatewayWsUrl(profile)`
- `api(request)`

Connection lookup, WebSocket URL minting, and API requests remain profile-scoped. Callers must pass the active profile through unchanged. In particular, OAuth gateway URLs contain one-time tickets: every dial or reconnect must call `getGatewayWsUrl(profile)` through the host rather than reuse a cached URL from an earlier connection.

`installHost()` installs a browser adapter before React boots. `resolveHost()` prefers that installed adapter, then wraps the compatible `window.hermesDesktop` Electron preload. If neither exists, boot fails with an actionable error instead of partially mounting the application.

## Capability sources

Capabilities are presence declarations, not health checks.

- Backend-owned features (`backendFiles`, `backendGit`, `backendLifecycle`, `persistentTerminal`) default closed until the connected server's capability manifest explicitly enables them. Electron's native preset retains its local persistent-terminal bridge.
- Browser-owned features (`browserClipboard`, `browserMicrophone`, `browserNotifications`, `screenWakeLock`) come from browser feature detection.
- Electron's static preset declares only the client and native shell surface supplied by its preload. Its native flags remain available independently of backend manifest enrichment.

An available operation may still reject because of authorization, connectivity, user denial, or another runtime failure. Such a rejection does not mutate the capability to absent. Conversely, an absent capability is not represented by attempting an operation and interpreting its failure.

## Native-only boundaries

The initial browser host does not claim Electron/OS integration:

- `deepLinkProtocol`
- `globalHotkeys`
- `nativeDialogs`
- `nativeWindows`
- `revealHostPath`
- `windowBelow`

Renderer features must use these flags to disable or replace native-only affordances. Existing optional direct `window.hermesDesktop` calls may remain while they are migrated, but host-neutral boot, gateway routing, and backend API traffic must not depend on them.

## No environment inference

Never infer renderer or host capabilities from `HERMES_DESKTOP` (or any other backend process environment variable). That variable describes how a backend process was launched, not which client is connected, where the client runs, or what its browser/native surface can do. The server manifest and client-side browser detection are the authoritative inputs.

## Backend-owned operations

Files, previews, Git, persistent terminals, and lifecycle actions always target the connected backend. Browser uploads carry bytes rather than fabricated local paths. Persistent terminal references include profile, backend identity, protocol epoch, and terminal id; a connection change fails closed instead of silently starting or retargeting a shell.

All backend operations use authenticated same-origin REST or WebSocket transports. Files remain jailed to authorized workspace roots. Git exposes an allowlisted operation vocabulary rather than arbitrary commands. Lifecycle actions accept fixed action names only and are advertised only when a canonical supervisor owns the fixed Hermes service. Unsupported uninstall remains unavailable.

## Browser-owned operations

Clipboard, microphone capture, notifications, external links, and screen wake lock use standards-based browser APIs. Permission denial, insecure context, revoked access, and missing user gestures are distinct runtime failures. Wake-lock acquisition is generation guarded so disabling it wins over an in-flight request.

## Compatibility and rollout

- `/desktop/` inherits dashboard authentication, Host/Origin checks, profile scoping, and CSRF policy.
- Old backends may retain chat compatibility; optional mutations remain unavailable until advertised.
- The browser bundle and Electron bundle are separate artifacts built from one renderer source tree.
- Browser-first support remains gated on browser E2E plus Electron packaged smoke. Windows and Linux native parity is not claimed until their native lanes run.
- Files/Git/terminal confirmation text should identify the backend host when destructive behavior could otherwise be ambiguous.

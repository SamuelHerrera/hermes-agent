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

- Backend-owned features (`backendFiles`, `backendGit`, `backendLifecycle`) come from the connected server's capability manifest and default to absent when omitted.
- Browser-owned features (`browserClipboard`, `browserMicrophone`, `browserNotifications`, `screenWakeLock`) come from browser feature detection.
- Electron declares the native surface supplied by its preload.

An available operation may still reject because of authorization, connectivity, user denial, or another runtime failure. Such a rejection does not mutate the capability to absent. Conversely, an absent capability is not represented by attempting an operation and interpreting its failure.

## Native-only boundaries

The initial browser host does not claim Electron/OS integration:

- `deepLinkProtocol`
- `nativeDialogs`
- `nativeWindows`
- `persistentTerminal`
- `revealHostPath`

Renderer features must use these flags to disable or replace native-only affordances. Existing optional direct `window.hermesDesktop` calls may remain while they are migrated, but host-neutral boot, gateway routing, and backend API traffic must not depend on them.

## No environment inference

Never infer renderer or host capabilities from `HERMES_DESKTOP` (or any other backend process environment variable). That variable describes how a backend process was launched, not which client is connected, where the client runs, or what its browser/native surface can do. The server manifest and client-side browser detection are the authoritative inputs.

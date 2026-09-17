# Native host and shared-broker integration

## Explicit shared ownership

A browser registers one native-host name. Installing another Hermes home into that registration now fails instead of replacing its owner. Same-home installation preserves its authentication and status. A registration lock serializes installers sharing the manifest destination.

The owner `config.json` can explicitly contain `clientTokens: { <clientId>: <independently-issued 64-hex token> }`. Native-host credentials are not accepted as client credentials. `readRuntimeConfig()` validates and preserves enrollment. There is no automatic credential discovery, copying, profile migration, or enrollment CLI in this slice.

A client home's private `chrome-bridge/broker-client.json` contains exactly `version: 1`, `clientId`, `socketPath`, and that client's independently issued `token`. Parent/server integration should deliberately choose this file, load it using `readBrokerClientConfig()`, and call `connectBrokerClient(config)` rather than starting another owner. Missing/invalid enrollment must not fall back to stealing registration or reading another home's config. The server factory wiring is owned by the parent change, not this module.

`connectBrokerClient()` exports a router with:

- `route(request, signal?)`: socket-authenticated, isolated IDs and bounded pending requests; abort and timeout cancel its own request.
- `releaseControl(namespacedTabId)`: acknowledged release; cannot release another client's tab.
- `close()`: settles pending calls; server disconnect cleanup cancels native requests and releases this controller's tab leases.

The broker assigns a fresh, unspoofable `controllerId` per socket (and one for its local owner). Each native request includes that identity at envelope level, not inside agent arguments. Explicit tab mutations acquire a controller lease; competing clients receive `TAB_BUSY`. New methods default to mutation classification. Read-only methods are `console`, `query`, `screenshot`, `snapshot`, `status`, `tabs`. Actions without an explicit tab cannot acquire a per-tab lease; callers must retain schema requirements for tab-bound mutations. Persistent selected-tab state is still browser state, not a client-private selection.

Cancellation reaches native stdio as `{type: "cancel", id, controllerId}`. Extension consumers must cancel the matching queued/in-flight action, release held input, and must not interpret it as a normal request. Cancellation cannot undo a completed browser side effect. Late native replies to cancelled calls are discarded using a bounded retired-ID set. Disconnect cancels outstanding requests, but completed held-input cleanup requires extension lifecycle support.

## Windows

Windows installation now cross-builds a genuine Go PE launcher (amd64 or Windows arm64), stores absolute Node/host/config paths in adjacent `native-host.exe.json`, and writes the per-user Chrome native-host registry value under HKCU. No shell/.cmd launcher, shell interpolation, administrator registration, or Authenticode requirement is used. Registry registration refuses a different existing owner.

The existing dist-only package includes the embedded Go source via `dist/native/windows-launcher.js`. Installation requires **Go on PATH** and builds before registration; failure is explicit and never falls back to a script. There is no generated executable committed to source and no signing claim. `buildWindowsLauncher({outputPath, goPath?, architecture?})` can stage a release executable, but the current installer deliberately builds its own launcher rather than consuming arbitrary downloaded binaries.

The broker uses a home-derived local Windows named pipe. Directory/file writes apply protected current-user ACLs using PowerShell, not POSIX mode bits alone. Browser-host IPC remains authenticated. Installation depends on Node, Go, PowerShell, and reg.exe being available for the current user.

Verification on macOS: real Go cross-build and PE header/machine validation; real temporary filesystem install with registry invocation substituted; registry argument/owner-refusal tests; ACL command construction tests. **Not verified on a Windows OS:** Chrome launch, named-pipe access/lifecycle, registry persistence, or actual PowerShell ACL application. Windows end-to-end acceptance remains a release gate, not a claimed result.

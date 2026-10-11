---
sidebar_position: 40
title: Browser preview in the PWA
---

# Browser preview in the PWA

The browser version of Desktop renders websites on the client using Scramjet.
Pages, scripts, images, redirects and media travel through an authenticated Wisp
transport. Touch input, text editing and audio playback are native to the phone
browser. The backend runs a small Node transport helper, not Chromium, Playwright
or a screenshot stream. Native Electron still uses its existing webview.

The Scramjet 2 controller uses MessagePorts without requiring SharedWorker,
SharedArrayBuffer or a cross-origin-isolated parent. Unsupported SharedWorker
interception is skipped without inventing a browser API.

## Included with installation

The standard macOS/Linux installer and Windows installer install the proxy's
locked npm dependencies as part of backend setup. This also applies to the
Desktop installer's staged backend setup. No separate npm command is needed.
`hermes update` installs or refreshes these dependencies for existing installs,
independently of the main workspace lockfile. Successful repeated installations
reuse matching dependencies; failed installs are not recorded as successful.

First-time CLI setup asks for the separate HTTPS proxy origin. Desktop's
graphical first-run setup offers the same prompt after provider setup (including
when the provider is deferred). Enter a bare origin such as
`https://browser.example.net`, or choose **Set up later**. Existing proxy origins
and listener settings are preserved. Blank Slate keeps the optional proxy off.
To configure or revisit the CLI prompt, run `hermes setup browser`.

Saving an origin in Desktop starts the helper on the connected backend without
restarting chat. CLI setup saves it for automatic startup with the backend.
The setup prompt does **not** create DNS, TLS certificates, or reverse-proxy
routes; those must already route the separate site to that backend's listener.

The helper uses Hermes-managed Node (22.22 or newer) and a separate lockfile with
exact dependency versions. Installation uses `npm ci --ignore-scripts` and never
downloads a browser for the proxy. Scramjet 2's alpha distribution is pinned;
upgrades are explicit, not automatic tracking of the npm alpha tag.

The helper starts automatically when a proxy origin is configured. Hermes uses
its managed Node resolver. Missing Node or dependencies leave chat and the API
working and show an actionable optional-feature error in the browser pane.
Stopping the backend closes the helper and its transport sessions.

## Configure two separate sites

The proxy must use a different HTTPS hostname **and registrable domain** from
Hermes. `browser.example.com` beside `hermes.example.com` is rejected. Public
Suffix List validation includes multi-label and private suffixes. Neither
Hermes nor an upstream authentication gate may use a cookie domain shared with
the proxy. Hermes authentication cookies must remain host-only.

For example, if Desktop is `https://hermes.example.com/desktop/`, publish the
proxy on a separately owned site and configure the backend serving that Desktop:

```bash
hermes config set desktop.browser_proxy_origin https://browser.example.net
hermes config set desktop.browser_proxy_port 9120
hermes config set desktop.browser_proxy_bind 127.0.0.1
```

Port `0` requests a dynamic port, useful in tests. A stable reverse proxy should
use a fixed port. The default listener is loopback. For an explicitly trusted
private network, `browser_proxy_bind` may name a single private interface IP,
for example a ZeroTier address. Wildcard and public addresses are rejected.
Do not expose the helper on an unauthenticated public IP.

Route the **entire proxy hostname** to the helper, including `/`, `/bootstrap`,
`/assets/`, `/sw.js`, `/service/` and `/wisp/`. Never send that hostname to the
Hermes Python API listener. A TLS reverse proxy must preserve the public Host,
Origin, binary WebSocket upgrades and security response headers. Do not cache
bootstrap or HTML responses. Restrict access to the private listener at the
network boundary. When Hermes uses `auth_disabled=true` behind an upstream
authentication gate, protect its entire hostname, including `/api/*` and
WebSockets, not just `/desktop/`. Keep that gate off the separate proxy host.
Avoid logging the bounded capability segment of `/wisp/`.

Add other publicly reachable management hostnames to
`desktop.browser_proxy_denied_hosts`. The helper automatically blocks the
Hermes parent and proxy hostnames and all their resolved addresses. Changes
saved through Desktop's config API are applied to the helper automatically.
For changes made directly through CLI config or a file edit, restart the backend
to apply them. Reload the PWA after changing its proxy origin.

## Authentication and isolation

### Explicit same-origin development override

For a development deployment whose owner deliberately accepts sharing Hermes's
browser security boundary with proxied third-party code:

```bash
hermes config set desktop.browser_proxy_allow_same_origin true
hermes config set desktop.browser_proxy_origin https://hermes.example.com
```

Restart the backend after CLI changes. Route `/browser-proxy/*` (without
stripping that prefix), including WebSockets, to its proxy listener. Keep the
existing access gate in front of **both** routes; after access verification,
strip Cookie, Authorization, and X-Hermes-Session-Token on the Node upstream.
All other paths still go to the Hermes API. No separate DNS/TLS hostname is
needed. The proxy service worker is scoped to `/browser-proxy/`, not `/`.

This is **not an isolation guarantee**: proxied code may access Hermes's DOM,
storage, browser credentials and authenticated APIs. Authentication, expiring
transport capabilities, and SSRF protections remain enabled, but do not restore
the browser origin boundary. The override defaults to false and requires the
exact HTTPS Hermes origin. Moving origins starts a separate website cookie store;
sign-in state on the old isolated site is not migrated.

1. Desktop calls authenticated `POST /api/browser-proxy/bootstrap` on Hermes.
   The endpoint requires its exact HTTPS request Origin and the active Hermes
   credential, even when the backend otherwise runs with public auth disabled.
2. Hermes sends a fresh, opaque, 30-second one-time capability to the Node helper
   through inherited stdio. No helper management endpoint is network-accessible.
3. Desktop passes only that proxy capability in the isolated iframe fragment.
   The controller removes the fragment before navigating to a website.
4. The proxy exchanges the one-time capability for a separate proxy-scoped
   session. Wisp upgrades require that session and the exact proxy Origin/Host.
   Sessions expire after one hour and close on unload when possible. There are
   at most eight tickets/sessions, four Wisp connections per session and 64 TCP
   streams per connection.
5. An optional `__Host-` cookie is Secure, HttpOnly, SameSite=None and Partitioned,
   with no Domain attribute. Wisp also uses its bounded proxy-only session URL,
   so blocked third-party cookies do not prevent playback. Hermes credentials
   never enter the proxy origin, storage, iframe messages or transport URLs.

Every target connection resolves to a checked global unicast address and connects
to that exact address. This prevents DNS rebinding between validation and socket
creation. Private, loopback, link-local, CGNAT, reserved, mapped/tunnel and
multicast addresses are denied. Direct IP targets, UDP, unknown stream types,
duplicate stream IDs and ports other than 80/443 are denied. Each redirected
resource creates a new checked stream when its destination changes.

The controller accepts commands only from its exact Hermes parent window and
Origin. Desktop accepts state only from that exact iframe window and proxy
Origin. Neither side interprets incoming HTML or executes messages as code.
Proxy response CSP blocks native network/form/frame escapes to Hermes. The
service worker reapplies that policy after Scramjet rewrites upstream headers.
The service worker is registered on the isolated proxy origin and routes only
Scramjet requests; controller and bootstrap requests are not target traffic.

**Preserve the parent Desktop CSP.** While this feature is configured,
`/desktop/` responses permit frames only on the isolated proxy origin or opaque
blob/data documents. They deliberately do not permit `frame-src 'self'`. Without
that restriction, a compromised proxy controller could navigate its iframe back
to Desktop and acquire the parent's privileged origin. Desktop also installs the
same CSP as a meta policy before creating the iframe, protecting cached/offline
PWA HTML that predates the server header. This restriction stays for the
document's lifetime. Same-origin HTML/document iframe previews are therefore
unavailable while the proxy is configured. Native
Electron webviews are unaffected. Hermes additionally rejects proxy-origin and
browser cross-site API/WebSocket traffic, including requests without Origin.

## Compatibility and verification

The client needs service workers, dedicated Workers, IndexedDB and WebAssembly.
Native SharedWorker is optional. Browser/site
compatibility, DRM,
upstream bot protection and account sign-in remain site-specific. Successful
native audio playback does not establish YouTube Music account or DRM playback.
Do not bypass upstream access restrictions to make a site work.

```bash
# Python configuration, authenticated API, actual helper and shutdown tests
scripts/run_tests.sh tests/hermes_cli/test_browser_proxy.py tests/hermes_cli/test_browser_proxy_routes.py -q

# Real HTTP/WebSocket auth and SSRF tests
cd hermes_cli/browser_proxy
npm test

# Explicit browser integration lane, only for testing
# Requires the repo's Playwright dependency and installed Chromium.
node --test test/browser.integration.mjs
```

The browser integration test uses separate HTTPS sites, an ordinary non-isolated
parent, normal browser storage partitioning and deliberately stripped proxy
cookies. Its cached-parent case also disables native SharedWorker to exercise the
mobile compatibility path. It exercises a real Scramjet service worker and
Wisp transport, redirect,
script fetch, image decoding, native input and advancing audio playback. It also
verifies private target rejection and blocks controller navigation back into the
privileged parent origin. This lane launches a disposable test browser only.
The normal runtime never launches a backend browser.

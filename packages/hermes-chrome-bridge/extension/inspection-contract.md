# Inspection integration contract

NEW DISPATCHERS MUST SEND REQUEST VERSION 2 for ping and EVERY content operation. Historical anonymous version-1 listeners ignore these requests, preventing old-listener response races after reinjection. The new handler accepts both versions for compatibility; response envelopes remain version 1.

- `hermes.bridge.snapshot`: required `format` (`both`, `dom`, `accessibility`); optional selector, limit, cursor, maxChars, fields, visibleOnly.
- `hermes.bridge.query`: same optional options, no format. Selector defaults to `*`.
- Defaults: snapshot 60, query 20, maxChars 100, visibleOnly true. Limits 1..500, maxChars 1..240.
- Fields: ref, role, name, text, value, box, state, tag. Box projects existing `boundingBox`; state projects existing checked/disabled/expanded/selected/sensitive keys. Missing fields preserves legacy element shape. No raw HTML.
- Work is capped at 1000 traversed elements per request, with actionable-first ordering within each scan batch. Only the returned slice is serialized. Text extraction has a shared 256-node/2048-character budget, then each output text field is bounded by maxChars. Empty result pages with nextCursor are possible for sparse selectors; keep following them.
- Output `nextCursor` is a single-use opaque bounded-cache capability. Pass it as input `cursor` with exactly the same normalized options. DOM mutations, document/frame replacement, and changed document URL reject continuation with `INVALID_SELECTOR` and cursor-specific message. Output `truncated` means another result page exists. Inaccessible frame coverage is separately explicit in `inaccessibleFrames: [{ref,reason:'inaccessible'}]`.

## Trusted action resolution

Send `{type:'hermes.bridge.resolve',version:1,target:<ref-or-selector>}` to the TOP frame content listener. It returns standard `hermes.bridge.result` envelope with:

```
{ref,sensitive,editable,box:{x,y,width,height},documentId,
 locator:{steps:[{kind:'frame'|'shadow'|'element',selector}]}}
```

Start at top `document`. For each step, querySelector in current root; frame means switch to that element's contentDocument, shadow means switch to its shadowRoot, element is the final target. Selectors are generated structural paths using tag and nth-of-type, not user text or values. `box` is in the owning document viewport, NOT top viewport. CDP should resolve the locator to a backend DOM node for focus/input rather than using unadjusted frame coordinates. Re-resolve immediately before acting, and validate sensitive/editable again in CDP to fail closed across page races. Never retry an already-dispatched trusted mutation.

Refs are opaque `h-<installation-instance>-d<document>-e<node>`, scoped to inspector and owner document. Detached/replaced elements, navigated/removed frames and foreign installation refs fail with ELEMENT_NOT_FOUND and a stale-ref message. A selector searches open shadows and same-origin frames; prefer the returned ref when duplicate selectors exist.

## Reload recovery

Use `{type:'hermes.bridge.ping',version:2}`. Pong adds `installationVersion:'inspection-2'`. Missing/wrong installationVersion means the background must reinject and verify a matching pong before sending operations. Same-version reinjection preserves the inspector/ref store and adds no duplicate handler. Different versions or invalidated event registrations dispose the old known listener, observer and indicator, then install once. Anonymous listeners from historical builds cannot be removed, so version-2 requests are mandatory for reload recovery. They ignore version 2 and cannot win response races.

## Native verification

`npx vitest run extension/inspection-native.test.ts` uses an isolated headless Playwright Chromium, never the user's browser. Requires workspace Playwright and its Chromium install. Unit coverage is in page-inspector.test.ts, content-bridge.test.ts, inspection-installation.test.ts.

import { bootstrapBrowserHost } from './platform/browser-bootstrap'

// Keep a stable, emitted marker so the post-build check can prove that the
// browser bootstrap — not Electron's main-only entry — owns the real graph.
Object.assign(globalThis, { __HERMES_BROWSER_ENTRY__: 'hermes-browser-bootstrap:v1' })

// main.tsx resolves the host synchronously at module evaluation time. Install
// and discover the browser host before loading any renderer side effects.
await bootstrapBrowserHost(window)
await import('./main')
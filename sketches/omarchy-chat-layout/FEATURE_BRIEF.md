# Omarchy-style Hermes Desktop layout — feature brief

## Reference captured

I captured the current Hermes Desktop window. The current app already has the raw material for this: a fixed session/project sidebar, an app header/titlebar with freed space, and a pane-shell tree where each zone has a tab strip and a single active pane body.

Relevant current code surfaces inspected:

- `apps/desktop/src/app/shell/titlebar-controls.tsx` — app header/titlebar controls, currently left-toolbar + profile/status/system controls.
- `apps/desktop/src/app/chat/index.tsx` — chat surface/header and primary-vs-tile behavior.
- `apps/desktop/src/components/pane-shell/tree/store.ts` — persisted layout tree store.
- `apps/desktop/src/components/pane-shell/tree/renderer/tree-group.tsx` — zone header/tab strip and active-pane body rendering.
- `apps/desktop/src/components/pane-shell/tree/renderer/tree-split.tsx` — split sizing/sash behavior.

## User intent, clarified

Add a second, toggleable Desktop layout mode inspired by Omarchy / tiling-window-manager workflows:

1. **Do not delete the existing tabbed layout.** Keep it as default/stable mode.
2. **Add an alternate `desktop/windows` mode.** Tabs are visually removed/replaced with window headers.
3. **Keep panes as panes.** Reuse existing pane-shell contributions and rendering; avoid a second chat implementation.
4. **Show multiple chats/screens at once.** Instead of one active tab per zone, the selected/open panes can be visible next to each other.
5. **Each visible pane gets a window header.** Header shows title/status/actions and acts as the drag handle for reorder/move.
6. **Horizontal scrolling workspace.** The main workspace becomes a wide canvas/strip of pane windows.
7. **Multiple desktops/workspaces.** Hotkeys switch desktop groups, like virtual desktops.
8. **Use the app header for navigation.** Header should show desktop chips plus a horizontal minimap of all screens and the current viewport range.

## Mockup variants

### A. Continuous horizontal workspace

Best first build. It maps cleanly to what Hermes already has: each pane/tab becomes a window card on a wide horizontal strip. Sidebar remains fixed. Header has desktop chips + minimap + mode toggle.

Strengths:
- Most like the user request.
- Minimal conceptual leap from current pane tree.
- Great for many chats/tools open side-by-side.

Risks:
- Need strong virtualization/perf guard for many live chat surfaces.
- Composer positioning in narrow cards needs rules.

### B. Desktops + focused viewport

Same windows, but each desktop owns a layout. Switching desktops changes the visible group. Header chips become primary navigation; minimap represents the current desktop.

Strengths:
- Strong Omarchy feel.
- Scales better than one infinite strip.
- Lets user group work by task: Chat, Build, Docs, Ship.

Risks:
- More state/persistence decisions: which panes belong to which desktop, what moves between desktops.

### C. Dense tiled matrix

A power-user grid view: all panes are visible in a 2D tiled matrix, still with window headers. Less horizontal-scroll focused, more “monitor wall”.

Strengths:
- Maximum information density.
- Useful for audits, multi-agent monitoring, terminal + chat dashboards.

Risks:
- Least similar to Omarchy horizontal desktops.
- Harder to keep chat readable at small sizes.

## Proposed feature set

### Layout mode

- `tabbed` = existing behavior.
- `desktop` / `windows` = alternate mode.
- Toggle exposed in app header and keyboard command.
- Persist per Desktop window/profile, not backend session.
- Existing layout tree remains valid; mode is presentation + organization layer, not a schema-breaking replacement.

### Window headers

Every visible pane/window needs:

- Drag handle/gripper.
- Pane title/session title.
- Status indicators: running, queued, needs approval, unread, profile, model/usage when chat.
- Close/minimize/focus actions where applicable.
- Optional per-pane strip tools currently shown in tab strip.
- Context menu parity with current tab strip: close this/others/right/all, reload, move to desktop.

### Reorder / movement

- Drag header left/right to reorder in horizontal strip.
- Drag to edge zones to split/dock, reusing existing FancyZones drop language where possible.
- Drag to a desktop chip to move the pane to that desktop.
- Multi-select can follow current tab selection grammar later, but not required in v1.

### Horizontal viewport + minimap

Header minimap should show:

- Each open window as a proportional segment.
- Color/type: chat, terminal, preview/browser, files, plan/artifact, plugin.
- Current scroll viewport as an outlined range.
- Click segment to scroll to that window.
- Drag viewport pill to pan horizontally.
- Scroll/trackpad updates minimap live with raf-coalescing.

### Multiple desktops

- Header desktop chips: `1`, `2`, `3`, `+`, optionally named.
- Hotkeys: likely `⌘1..⌘9` or `⌃1..⌃9` depending existing conflicts; verify keybind registry first.
- Move pane to desktop via context menu and drag-over chip.
- Each desktop persists its window order and scroll position.
- Optional: desktop names/icons later.

### Scrolling behavior

- Main desktop canvas is horizontally scrollable.
- Trackpad native horizontal scroll works.
- Shift+wheel maps vertical wheel to horizontal scroll.
- Keyboard: previous/next window, previous/next desktop, jump to focused pane.
- Minimap keeps the current viewport visible.

### Compatibility / guardrails

- Do not remount hot chat surfaces unnecessarily; preserve existing hidden-pane subscription gates.
- Hidden/off-desktop panes should not subscribe to streaming message arrays.
- Keep primary chat route semantics intact.
- Keep existing tabbed layout tree persistence untouched or migrate gently.
- Secondary/pop-out/watch windows should probably stay simple/tabbed unless explicitly enabled.
- Narrow viewport should fall back to current narrow overlay/collapse behavior or a single-column scroll.

## Implementation plan, no code yet

### Phase 0 — design lock

1. Pick winning layout direction: I recommend Variant A + Variant B desktops.
2. Choose names: `Tabbed` vs `Desktop` or `Tabs` vs `Windows`.
3. Choose hotkey family after checking conflicts.
4. Decide if v1 includes drag-to-reorder only, or full split/dock movement too.

### Phase 1 — renderer state model

1. Add small renderer-owned layout mode store, persisted with scoped key.
2. Add desktop/workspace store:
   - active desktop id
   - ordered pane/window ids per desktop
   - per-desktop horizontal scroll offset
3. Derive initial desktop windows from the existing layout tree so current panes appear without migration.
4. Tests: mode persistence, desktop creation/switching, no bleed across profile/window scope.

### Phase 2 — shell/header chrome

1. Add a header contribution/component for desktop chips and minimap.
2. Place it in the freed titlebar center area, keeping traffic-light and fixed titlebar controls clear.
3. Add mode toggle in the app header overflow or direct chrome.
4. Tests: titlebar layout with narrow sidebar/tool budget and desktop mode on/off.

### Phase 3 — alternate pane renderer

1. In the pane-shell root renderer, branch on layout mode:
   - `tabbed` uses current `TreeSplit/TreeGroup` renderer unchanged.
   - `desktop` uses a new `DesktopCanvas` that renders pane windows with headers.
2. Reuse existing pane contribution rendering via `ContribRender` and `PaneVisibleContext`.
3. Preserve pane keep-alive/visibility rules: only visible windows subscribe hot.
4. Tests: all visible windows render, inactive/off-desktop windows are hidden without hot subscriptions.

### Phase 4 — interactions

1. Header drag reorder within a desktop.
2. Minimap click/drag scroll.
3. Shift+wheel horizontal scroll.
4. Desktop hotkeys and move-to-desktop menu.
5. Optional later: FancyZones split/dock in desktop mode.

### Phase 5 — polish and verification

1. Visual states: running, unread, approval-needed, focused, minimized.
2. Accessibility: window headers are keyboard-focusable; desktop chips are tabs/radio-like controls; minimap has textual fallback.
3. Perf checks with multiple running chat tiles.
4. Run focused vitest/typecheck and live screenshot verification.

## Recommended MVP cut

Build only:

- Toggleable mode.
- Horizontal desktop canvas.
- Window headers replacing tab chips.
- Reorder by drag.
- Header minimap with click-to-scroll.
- 3 desktop chips + hotkey switching.

Defer:

- Freeform 2D drag placement.
- Cross-desktop drag/drop.
- Multi-select window moves.
- Complex saved named desktop templates.
- Animated zoom/minimap thumbnails.

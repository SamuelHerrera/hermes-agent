# Hermes Desktop Scroll-Windows MVP

## Goal

Add a second, toggleable Hermes Desktop layout mode that behaves like an internal window manager for chats/screens:

- current tabbed/pane view remains the default and stays preserved
- new mode is always **scroll-window mode**
- chats/screens become visible internal windows on a generated grid
- the grid auto-expands based on available screen size and number of open windows
- each desktop/workspace has independent scroll position and window order
- the top app header shows a centered minimap for the active desktop
- workspace numbers live on the right side of the header
- layout mode/template controls live in the menu, not the header

This MVP should prove the interaction model without trying to fully clone Hyprland/Omarchy.

## Wireframes

Openable HTML wireframe:

- [`index.html`](./index.html)

Rendered references:

- [Step 1 — two columns](./mockup-step-1-two-columns.png)
- [Step 2 — more columns](./mockup-step-2-more-columns.png)
- [Step 3 — rows](./mockup-step-3-rows.png)
- [Step 4 — matrix](./mockup-step-4-matrix.png)
- [Step 5 — focus + side stack](./mockup-step-5-focus-stack.png)

## MVP boundary

### In scope

1. **Toggleable layout surface mode**
   - Add a renderer-owned setting:
     - `tabbed`
     - `scroll-windows`
   - Default remains `tabbed`.
   - Toggle is exposed from menu / command palette, not as a persistent header button.

2. **Generated scroll grid**
   - No fixed `2x2` assumption.
   - Grid layout is generated from:
     - viewport width/height
     - minimum useful window size
     - number of windows in the active desktop
   - If the viewport can fit more columns/rows, use them.
   - If it cannot, extend horizontally and preserve scroll mode.

3. **Auto-add chats/windows**
   - New chat/session tile opens as a window in the active desktop.
   - New tool/panel windows can also be adopted later, but first MVP should prioritize chats.
   - The active desktop automatically recalculates its grid when a window is added or removed.

4. **Multiple desktops/workspaces**
   - Provide a small fixed initial count, e.g. 5 desktops.
   - Header right side shows workspace chips: `1 2 3 4 5`.
   - Switching desktops is immediate and does not destroy window state.
   - Each desktop stores:
     - ordered window ids
     - focused window id
     - scrollLeft / scrollTop
     - generated grid metadata

5. **Keyboard shortcuts**
   - Add actions, with careful defaults to avoid stealing existing Hermes shortcuts.
   - MVP shortcuts:
     - next workspace
     - previous workspace
     - switch workspace 1–5
     - focus next window
     - focus previous window
   - Movement shortcuts can wait.
   - If conflicts are risky, ship actions unbound but visible/rebindable first.

6. **Minimap**
   - Centered in app header only in `scroll-windows` mode.
   - Shows all windows in the active desktop as compact segments.
   - Shows current viewport as an outlined pill/rectangle.
   - Clicking a segment scrolls that window into view.
   - Dragging the viewport indicator is optional for MVP+.

7. **Window chrome**
   - Every visible chat/screen appears as an internal window with:
     - number
     - title
     - focused/unfocused border
     - draggable-looking header
     - close/menu affordance if already supported by the pane
   - MVP does not need full drag-reorder, but the header should visually prepare for it.

### Out of scope for MVP

- Full Hyprland-style tiling algorithm parity.
- Arbitrary drag-to-split behavior.
- Dragging windows between desktops.
- Animated workspace transitions.
- Floating scratchpad windows.
- Persisted user-authored layout editor for this mode.
- Replacing the current pane/tab layout.
- Showing every possible tool pane as a window on day one.

## Minimum generated-grid model

The MVP should use a simple deterministic generator, not hand-authored presets.

Inputs:

```ts
interface ScrollGridInput {
  viewportWidth: number
  viewportHeight: number
  windowCount: number
  minWindowWidth: number
  minWindowHeight: number
  gap: number
}
```

Output:

```ts
interface ScrollGridLayout {
  columns: number
  rows: number
  windowWidth: number
  windowHeight: number
  canvasWidth: number
  canvasHeight: number
}
```

Suggested initial behavior:

1. Compute how many columns and rows fit in the visible viewport.
2. Prefer filling rows before adding horizontal overflow.
3. Keep each window above the minimum usable chat size.
4. If all windows do not fit, increase canvas width by adding columns.
5. Keep vertical height bounded to the viewport; horizontal scroll is the main navigation axis.

Example outcomes:

| Windows | Large screen | Smaller screen |
|---:|---|---|
| 1 | 1×1 | 1×1 |
| 2 | 2 columns | 2 columns or horizontal overflow |
| 3 | 3 columns or 2×2 with one empty slot | horizontal overflow |
| 4 | 2×2 matrix | 2 rows with horizontal overflow |
| 6 | 3×2 matrix | paged horizontal matrix |
| 9+ | 3×3 / 4×2 if space allows | horizontal matrix pages |

## Preservation strategy

Do not mutate or replace the current layout tree for MVP.

Use a separate mode switch:

```ts
type LayoutSurfaceMode = 'tabbed' | 'scroll-windows'
```

Current behavior remains:

```tsx
<TreeNode node={layoutTree} />
```

New behavior becomes:

```tsx
{layoutSurfaceMode === 'tabbed' ? (
  <TreeNode node={layoutTree} />
) : (
  <ScrollWindowWorkspace tree={layoutTree} />
)}
```

The existing tabbed renderer, existing layout presets, existing tree persistence, and existing pane visibility rules remain intact.

Separate persistence keys:

```text
hermes.desktop.layoutSurfaceMode.v1
hermes.desktop.scrollWindows.workspaces.v1
hermes.desktop.scrollWindows.activeWorkspace.v1
```

This keeps rollback easy: switching back to `tabbed` restores the current system exactly.

## Implementation phases

### Phase 1 — mode and menu toggle

Deliverables:

- add `layoutSurfaceMode` store
- add menu / command-palette toggle
- persist selected mode
- no behavioral changes when mode is `tabbed`

Acceptance:

- app boots in current tabbed mode
- user can switch to `scroll-windows`
- user can switch back to current view without losing current pane layout

### Phase 2 — generated grid renderer

Deliverables:

- add `ScrollWindowWorkspace`
- render active desktop windows in generated grid
- auto-fit rows/columns from viewport size
- horizontal overflow when needed
- focus border and numbered window headers

Acceptance:

- 1, 2, 4, 6+ windows produce different generated layouts
- resizing the window recalculates layout
- opening a new chat auto-adds a new window to active desktop
- closing a chat removes it and reflows the grid

### Phase 3 — desktops/workspaces

Deliverables:

- active workspace store
- workspace chips in header right side
- per-workspace window order and focus
- per-workspace scroll position

Acceptance:

- switching workspace is immediate
- each workspace restores its scroll position
- windows remain assigned to their workspace
- empty workspace shows a useful empty state / add-chat affordance

### Phase 4 — minimap

Deliverables:

- centered header minimap in `scroll-windows` mode
- segment per window in active desktop
- viewport indicator based on scroll position
- click segment to scroll window into view

Acceptance:

- minimap updates when windows are added/removed
- minimap updates while scrolling
- clicking a segment scrolls to the matching window
- header does not show layout toggle controls

### Phase 5 — keyboard actions

Deliverables:

- actions for workspace next/previous
- actions for workspace 1–5
- actions for focus next/previous window
- rebindable shortcut entries

Acceptance:

- no default conflict with existing tab/profile/session shortcuts
- shortcuts work only in the correct context
- shortcuts do not hijack composer typing

## Recommended first PR

Keep the first PR as small as possible:

1. add mode store
2. add menu/palette toggle
3. add read-only generated scroll grid for chat/session windows
4. add basic header window chrome
5. no drag/reorder yet
6. no complex desktop movement yet

That first PR proves the core UX: **new chats become windows in a generated scrollable desktop while the old view remains intact**.

## Open decisions before implementation

1. Are header right-side chips strictly **workspaces**, while window numbers live only inside window headers?
   - Recommendation: yes.
2. Should new chats always open in the active workspace?
   - Recommendation: yes for MVP.
3. Should tool panes like Terminal/Files/Preview enter this mode immediately?
   - Recommendation: only if already visible; prioritize chat windows first.
4. Should shortcuts ship bound or unbound?
   - Recommendation: bind next/previous workspace only if conflict-free; ship numbered workspace actions unbound/rebindable first.
5. Should layout generation prefer matrix density or wide columns?
   - Recommendation: matrix when the screen is large enough; otherwise horizontal scroll columns.

## Success definition

The MVP is successful when:

- current Hermes Desktop tabbed layout is unchanged by default
- user toggles to scroll-window mode from menu
- each newly opened chat appears as a numbered internal window
- windows auto-arrange into the best generated grid for the screen
- overflow is horizontal and scrollable per desktop
- minimap gives a clear visual overview of the active desktop
- workspace chips switch desktops instantly
- switching back to current view is safe and lossless

# Revised window-layout mockups

This pass corrects the prior issue: the windows are now explicitly visible as bordered internal windows with numbered headers, independent bodies, active focus border, and close/status areas.

Updated requirements captured:

- Always use scroll mode. The workspace/canvas is scrollable for every layout.
- The centered top element is always a minimap of the scroll canvas.
- Workspace/window numbers live on the right side of the app header.
- The layout toggle/chooser belongs in the menu, not directly in the header.
- Explore multiple layout templates step by step: two columns, more columns, rows, matrix, focus+side stack.

Mockup images:

1. `mockup-step-1-two-columns.png`
2. `mockup-step-2-more-columns.png`
3. `mockup-step-3-rows.png`
4. `mockup-step-4-matrix.png`
5. `mockup-step-5-focus-stack.png`

Recommended implementation framing:

- Treat this as a scrollable internal-window canvas with selectable layout templates.
- The existing tabbed pane shell remains the normal mode.
- The new mode should render pane contributions as numbered window tiles.
- Layout templates decide geometry; minimap tracks the full scrollable canvas and viewport.
- Window/workspace chips on the right should switch workspaces or focus numbered windows, depending final UX decision.
- The header stays clean: traffic/app identity left, minimap center, numbers/menu right.

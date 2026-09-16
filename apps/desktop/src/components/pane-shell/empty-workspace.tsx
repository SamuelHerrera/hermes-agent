/** Shared inert empty state. It must not mount a chat runtime or a composer. */
export function EmptyWorkspace() {
  return (
    <div
      className="relative grid h-full min-h-0 flex-1 place-items-center overflow-hidden bg-(--ui-chat-surface-background) px-8 py-10"
      data-empty-workspace=""
    >
      <div className="select-none text-center text-sm text-(--ui-muted-fg)">
        <div className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-(--ui-subtle-fg)">
          No tabs open
        </div>
        <div className="text-xs text-(--ui-faint-fg)">Open a session from the sidebar to start.</div>
      </div>
    </div>
  )
}

/** Shared muted branch connector for child chat and terminal rows. */
export function TreeStem({ children }: { children: string }) {
  return (
    <span
      aria-hidden
      className="shrink-0 font-mono text-[0.625rem] leading-none text-(--ui-text-quaternary)"
      data-tree-stem
    >
      {children}
    </span>
  )
}

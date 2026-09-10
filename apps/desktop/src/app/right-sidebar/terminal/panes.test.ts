import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./chrome', () => ({ TerminalPaneChrome: () => null }))

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

async function setup() {
  const tree = await import('@/components/pane-shell/tree/store')
  const model = await import('@/components/pane-shell/tree/model')
  const { registry } = await import('@/contrib/registry')
  const terminals = await import('./terminals')
  const { watchTerminalPanes } = await import('./panes')
  registry.register({
    id: 'workspace',
    area: 'panes',
    data: { placement: 'main', uncloseable: true },
    render: () => null
  })
  tree.declareDefaultTree(model.group(['workspace']))
  tree.watchContributedPanes()
  watchTerminalPanes()

  return { tree, model, registry, ...terminals }
}

describe('individual terminal panes', () => {
  it('gives each interactive and read-only terminal one main tab without stealing focus for agent work', async () => {
    const s = await setup()
    const first = s.createTerminal('/repo')
    const second = s.createTerminal('/elsewhere')
    const agent = s.ensureAgentTerminal('proc-1', 'Build', { ownerSessionId: 'chat', cwd: '/repo' })!
    const group = s.model.findGroupOfPane(s.tree.$layoutTree.get()!, s.terminalPaneId(first))!
    expect(group.panes).toEqual([
      'workspace',
      s.terminalPaneId(first),
      s.terminalPaneId(second),
      s.terminalPaneId(agent)
    ])
    expect(group.active).toBe(s.terminalPaneId(second))
    expect(s.registry.getArea('panes').filter(pane => pane.id === 'terminal')).toEqual([])
    expect(s.$terminals.get().find(terminal => terminal.id === agent)?.ownerSessionId).toBe('chat')
  })

  it('closes the tab non-destructively and reopens the same terminal from navigation', async () => {
    const s = await setup()
    const id = s.createTerminal('/repo', { projectId: 'project', profile: 'default' })
    s.updateTerminalReviveBuffer(id, 'kept history')
    s.tree.closeTabPane(s.terminalPaneId(id))
    expect(s.model.allPaneIds(s.tree.$layoutTree.get()!)).not.toContain(s.terminalPaneId(id))
    expect(s.$terminals.get()).toEqual([
      expect.objectContaining({ id, hidden: true, reviveBuffer: 'kept history', projectId: 'project' })
    ])
    s.selectTerminal(id)
    expect(s.$terminals.get()).toHaveLength(1)
    expect(s.model.findGroupOfPane(s.tree.$layoutTree.get()!, s.terminalPaneId(id))?.active).toBe(s.terminalPaneId(id))
  })

  it('does not re-open a closed agent tab when process snapshots repeat', async () => {
    const s = await setup()
    const id = s.ensureAgentTerminal('proc-closed', 'Build')!
    s.tree.closeTabPane(s.terminalPaneId(id))
    s.ensureAgentTerminal('proc-closed', 'Build', { ownerSessionId: 'chat', cwd: '/repo' })
    expect(s.$terminals.get()).toHaveLength(1)
    expect(s.$terminals.get()[0]).toMatchObject({ hidden: true, ownerSessionId: 'chat' })
    expect(s.model.allPaneIds(s.tree.$layoutTree.get()!)).not.toContain(s.terminalPaneId(id))
    s.openAgentTerminal('proc-closed', 'Build')
    expect(s.model.allPaneIds(s.tree.$layoutTree.get()!)).toContain(s.terminalPaneId(id))
  })

  it('supports moving terminals into separate zones and closing all tabs without killing shells', async () => {
    const s = await setup()
    const first = s.createTerminal('/repo')
    const second = s.createTerminal('/other')
    const group = s.model.findGroupOfPane(s.tree.$layoutTree.get()!, s.terminalPaneId(first))!
    s.tree.moveTreePane(s.terminalPaneId(second), { groupId: group.id, pos: 'right' })
    expect(s.model.findGroupOfPane(s.tree.$layoutTree.get()!, s.terminalPaneId(first))?.id).not.toBe(
      s.model.findGroupOfPane(s.tree.$layoutTree.get()!, s.terminalPaneId(second))?.id
    )
    s.tree.closeAllTreeTabs(s.terminalPaneId(second))
    expect(s.$terminals.get().find(terminal => terminal.id === second)?.hidden).toBe(true)
    expect(s.$terminals.get().find(terminal => terminal.id === first)?.hidden).not.toBe(true)
  })

  it('persists closed manual entries and their project ownership across relaunch', async () => {
    const s = await setup()
    const id = s.createTerminal('/repo', { projectId: 'project', profile: 'work' })
    s.hideTerminal(id)
    vi.resetModules()
    const restored = await import('./terminals')
    expect(restored.$terminals.get()).toEqual([
      expect.objectContaining({ id, cwd: '/repo', projectId: 'project', profile: 'work', hidden: true })
    ])
    expect(restored.$openTerminals.get()).toEqual([])
  })

  it('keeps chat ownership when the agent closes its output tab through the tool bridge', async () => {
    const s = await setup()
    const id = s.ensureAgentTerminal('tool-close', 'Build', { ownerSessionId: 'chat', cwd: '/repo' })!
    expect(s.closeAgentTerminalByProc('tool-close')).toBe(true)
    expect(s.$terminals.get()).toEqual([expect.objectContaining({ id, ownerSessionId: 'chat', hidden: true })])
    s.selectTerminal(id)
    expect(s.model.allPaneIds(s.tree.$layoutTree.get()!)).toContain(s.terminalPaneId(id))
  })
})

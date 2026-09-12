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
  it('filters terminal tabs by selected profile without closing shells, and All Profiles restores open tabs', async () => {
    const s = await setup()
    const { $activeGatewayProfile, $showAllProfiles } = await import('@/store/profile')
    const local = s.createTerminal('/repo', { profile: 'default' })
    const remote = s.createTerminal('/repo', { profile: 'hp-remote' })
    const agent = s.ensureAgentTerminal('hp-process', 'Build', { profile: 'hp-remote', cwd: '/repo' })!
    $activeGatewayProfile.set('hp-remote')
    s.selectTerminal(agent)
    $activeGatewayProfile.set('default')
    const closed = s.createTerminal('/closed', { profile: 'default' })
    s.hideTerminal(closed)
    s.selectTerminal(local)
    const entries = s.$terminals.get()
    const panes = () => s.model.allPaneIds(s.tree.$layoutTree.get()!)

    expect(panes()).toContain(s.terminalPaneId(local))
    expect(panes()).not.toContain(s.terminalPaneId(remote))
    $activeGatewayProfile.set('hp-remote')
    expect(panes()).not.toContain(s.terminalPaneId(local))
    expect(panes()).toEqual(expect.arrayContaining([s.terminalPaneId(remote), s.terminalPaneId(agent)]))
    expect(s.$terminals.get()).toBe(entries)
    expect(s.$activeTerminalId.get()).toBe(remote)
    s.cycleTerminal(1)
    expect(s.$activeTerminalId.get()).toBe(agent)

    $activeGatewayProfile.set('empty-profile')
    expect(panes()).toEqual(['workspace'])
    expect(s.$activeTerminalId.get()).toBeNull()
    $showAllProfiles.set(true)
    expect(panes()).toEqual(
      expect.arrayContaining([s.terminalPaneId(local), s.terminalPaneId(remote), s.terminalPaneId(agent)])
    )
    expect(panes()).not.toContain(s.terminalPaneId(closed))
    expect(s.$terminals.get()).toBe(entries)
    $showAllProfiles.set(false)
    $activeGatewayProfile.set('default')
    expect(panes()).toEqual(['workspace', s.terminalPaneId(local)])
  })

  it('captures the creation profile and never selects a same-cwd shell from another backend', async () => {
    const s = await setup()
    const { $activeGatewayProfile } = await import('@/store/profile')
    const { $currentCwd } = await import('@/store/session')
    const local = s.createTerminal('/shared')
    $activeGatewayProfile.set('hp-remote')
    const remote = s.createTerminal('/other')
    expect(s.$terminals.get().find(term => term.id === remote)?.profile).toBe('hp-remote')
    $currentCwd.set('/shared')
    expect(s.$activeTerminalId.get()).toBe(remote)
    s.selectTerminal(local)
    expect(s.$activeTerminalId.get()).toBe(remote)
    expect(s.model.allPaneIds(s.tree.$layoutTree.get()!)).not.toContain(s.terminalPaneId(local))
    s.closeTerminal(remote)
    expect(s.$activeTerminalId.get()).toBeNull()
    expect(s.$terminals.get().map(term => term.id)).toEqual([local])
  })

  it('matches session cwd only against the active backend even in All Profiles', async () => {
    const s = await setup()
    const { $activeGatewayProfile, $showAllProfiles } = await import('@/store/profile')
    const { $currentCwd } = await import('@/store/session')
    const local = s.createTerminal('/shared', { profile: 'default' })
    $activeGatewayProfile.set('hp-remote')
    const remote = s.createTerminal('/shared')
    const other = s.createTerminal('/other')
    $showAllProfiles.set(true)
    $currentCwd.set('/shared')
    expect(s.$activeTerminalId.get()).toBe(remote)
    s.selectTerminal(local)
    $currentCwd.set('/other')
    expect(s.$activeTerminalId.get()).toBe(other)
    s.selectTerminal(local)
    $currentCwd.set('/shared')
    expect(s.$activeTerminalId.get()).toBe(remote)
  })

  it('opens a newly requested agent output on its foreground profile without reassigning existing owners', async () => {
    const s = await setup()
    const { $activeGatewayProfile } = await import('@/store/profile')
    $activeGatewayProfile.set('hp-remote')
    s.openAgentTerminal('foreground-process', 'Build')
    const terminal = s.$terminals.get()[0]
    expect(terminal.profile).toBe('hp-remote')
    expect(s.$openTerminals.get().map(term => term.id)).toContain(terminal.id)
    $activeGatewayProfile.set('default')
    s.openAgentTerminal('foreground-process', 'Build')
    expect(s.$terminals.get()[0].profile).toBe('hp-remote')
    expect(s.$openTerminals.get()).toEqual([])
  })

  it('treats legacy unowned entries as default, not whichever remote profile is selected', async () => {
    window.localStorage.setItem(
      'hermes.desktop.terminals.v1',
      JSON.stringify({
        activeTerminalId: 'legacy',
        terminals: [{ id: 'legacy', title: 'Shell', cwd: '/repo', auto: true }]
      })
    )
    const s = await setup()
    const { $activeGatewayProfile, $showAllProfiles } = await import('@/store/profile')
    expect(s.$openTerminals.get().map(term => term.id)).toEqual(['legacy'])
    $activeGatewayProfile.set('hp-remote')
    expect(s.$openTerminals.get()).toEqual([])
    $showAllProfiles.set(true)
    expect(s.$openTerminals.get().map(term => term.id)).toEqual(['legacy'])
    expect(s.$terminals.get()[0].profile).toBeUndefined()
  })

  it('opens manual terminals immediately but keeps discovered agent terminals out of tabs until selected', async () => {
    const s = await setup()
    const first = s.createTerminal('/repo')
    const second = s.createTerminal('/elsewhere')
    const agent = s.ensureAgentTerminal('proc-1', 'Build', { ownerSessionId: 'chat', cwd: '/repo' })!
    const group = s.model.findGroupOfPane(s.tree.$layoutTree.get()!, s.terminalPaneId(first))!
    expect(group.panes).toEqual(['workspace', s.terminalPaneId(first), s.terminalPaneId(second)])
    expect(group.active).toBe(s.terminalPaneId(second))
    expect(s.$activeTerminalId.get()).toBe(second)
    expect(s.registry.getArea('panes').filter(pane => pane.id === 'terminal')).toEqual([])
    expect(s.$terminals.get().find(terminal => terminal.id === agent)).toMatchObject({
      ownerSessionId: 'chat',
      hidden: true
    })
    s.cycleTerminal(1)
    expect(s.$activeTerminalId.get()).toBe(first)
    s.selectTerminal(agent)
    s.ensureAgentTerminal('proc-1', 'Build', { ownerSessionId: 'chat', cwd: '/updated' })
    expect(s.model.findGroupOfPane(s.tree.$layoutTree.get()!, s.terminalPaneId(agent))?.active).toBe(
      s.terminalPaneId(agent)
    )
    expect(s.$openTerminals.get().map(term => term.id)).toEqual([first, second, agent])
  })

  it('keeps discovery and repeated snapshots sidebar-only even with no terminal tabs or after profile switches', async () => {
    const s = await setup()
    const { $activeGatewayProfile, $showAllProfiles } = await import('@/store/profile')
    const before = s.tree.$layoutTree.get()
    const id = s.ensureAgentTerminal('unopened', 'Build')!
    s.ensureAgentTerminal('unopened', 'Build', { ownerSessionId: 'chat', profile: 'default', cwd: '/repo' })
    $activeGatewayProfile.set('other')
    $showAllProfiles.set(true)
    $activeGatewayProfile.set('default')
    expect(s.$terminals.get()).toEqual([expect.objectContaining({ id, ownerSessionId: 'chat', hidden: true })])
    expect(s.$openTerminals.get()).toEqual([])
    expect(s.$activeTerminalId.get()).toBeNull()
    expect(s.tree.$layoutTree.get()).toBe(before)
    s.openAgentTerminal('unopened', 'Build')
    expect(s.$terminals.get()).toHaveLength(1)
    expect(s.model.findGroupOfPane(s.tree.$layoutTree.get()!, s.terminalPaneId(id))?.active).toBe(s.terminalPaneId(id))
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
    s.selectTerminal(id)
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

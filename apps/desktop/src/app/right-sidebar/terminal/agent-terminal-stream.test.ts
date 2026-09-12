import { describe, expect, it, vi } from 'vitest'

import { registerAgentTerminalWriter, seedAgentTerminalCommand, syncAgentTerminalSnapshot, writeAgentTerminalChunk } from './agent-terminal-stream'
import { closeTerminal, ensureAgentTerminal } from './terminals'

describe('removed agent terminal output', () => {
  it('releases backlog and ignores late output and process snapshots after removal', () => {
    const id = ensureAgentTerminal('removed-output', 'Build')!
    const writer = vi.fn()
    const unregister = registerAgentTerminalWriter('removed-output', writer)
    writeAgentTerminalChunk('removed-output', 'old output')
    expect(writer).toHaveBeenCalledWith('old output')
    writer.mockClear()
    closeTerminal(id)
    writeAgentTerminalChunk('removed-output', 'late output')
    seedAgentTerminalCommand('removed-output', 'Build')
    syncAgentTerminalSnapshot('removed-output', 'stale snapshot')
    expect(writer).not.toHaveBeenCalled()
    unregister()
    const reopened = vi.fn()
    registerAgentTerminalWriter('removed-output', reopened)()
    expect(reopened).not.toHaveBeenCalled()
  })
})

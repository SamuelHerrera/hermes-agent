import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ServerConfig } from './mcp-tab'

const callbacks = () => ({
  onAuthenticate: vi.fn(),
  onBack: vi.fn(),
  onProbe: vi.fn(),
  onRemove: vi.fn(),
  onToggle: vi.fn(),
  onToggleTool: vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'hermesDesktop')
})

describe('Chrome bridge MCP status', () => {
  it('shows the disconnected native bridge separately from a healthy MCP process', () => {
    const actions = callbacks()
    const openExternal = vi.fn(async () => undefined)
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { openExternal }
    })

    render(
      <ServerConfig
        authing={false}
        description="Control an authorized Chrome profile"
        entry={{ command: 'npx' }}
        name="hermes-chrome-bridge"
        {...actions}
        probe={{
          ok: true,
          tools: [{ description: 'status', name: 'chrome_bridge_status' }],
          health: { chromeBridge: { bridgeConnected: false, nativeConnected: false } }
        }}
        saved
        saving={false}
      />
    )

    expect(screen.getAllByText('Chrome disconnected').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(actions.onProbe).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Setup guide' }))
    expect(openExternal).toHaveBeenCalledWith(
      'https://hermes-agent.nousresearch.com/docs/user-guide/features/chrome-bridge'
    )
  })

  it('lists simultaneous connections with distinguishable public identities', () => {
    render(<ServerConfig authing={false} description={null} entry={{ command: 'npx' }}
      name="hermes-chrome-bridge" {...callbacks()} probe={{ ok: true, tools: [], health: { chromeBridge: {
        bridgeConnected: true, nativeConnected: true, connections: [
          { connectionId: '11111111-1111-4111-8111-111111111111', label: 'Work' },
          { connectionId: '22222222-2222-4222-8222-222222222222', label: 'Personal' }
        ]
      } } }} saved
      saving={false} />)
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('Personal')).toBeTruthy()
    expect(screen.getByText('11111111-1111-4111-8111-111111111111')).toBeTruthy()
    expect(screen.getByText('22222222-2222-4222-8222-222222222222')).toBeTruthy()
  })

  it('shows the connected profile without the setup CTA', () => {
    render(
      <ServerConfig
        authing={false}
        description={null}
        entry={{ command: 'npx' }}
        name="hermes-chrome-bridge"
        {...callbacks()}
        probe={{
          ok: true,
          tools: [],
          health: { chromeBridge: { bridgeConnected: true, nativeConnected: true } }
        }}
        saved
        saving={false}
      />
    )

    expect(screen.getByText('Chrome connected')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Setup guide' })).toBeNull()
  })
})

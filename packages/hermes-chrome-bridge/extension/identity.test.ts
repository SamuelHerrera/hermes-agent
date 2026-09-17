import { describe, expect, it, vi } from 'vitest'

import { createIdentityStore } from './identity-store.js'
import { createConnectionController, type NativePortLike } from './lifecycle.js'

const identity = { connectionId: '11111111-1111-4111-8111-111111111111', label: 'Work' }

function port(): NativePortLike {
  return { disconnect: vi.fn(), postMessage: vi.fn(),
    onDisconnect: { addListener: vi.fn() }, onMessage: { addListener: vi.fn() } }
}

describe('profile identity lifecycle', () => {
  it('persists one public identity across parallel reads, relabeling and worker restarts', async () => {
    let values: Record<string, unknown> = {}

    const storage = {
      get: async () => values,
      set: async (next: Record<string, unknown>) => { values = next }
    }

    const uuid = vi.fn(() => identity.connectionId)
    const read = createIdentityStore(storage, uuid)
    const results = await Promise.all([read('Work'), read('Personal')])
    expect(results.map(result => result.connectionId)).toEqual([identity.connectionId, identity.connectionId])
    expect(uuid).toHaveBeenCalledOnce()
    expect(await createIdentityStore(storage, uuid)()).toEqual({ ...identity, label: 'Personal' })

    for (const label of ['me@example.com', 'token=private-value', 'sk-live-1234567890', '1234567890123456']) {
      expect((await read(label)).label).toBe(`Chrome ${identity.connectionId.slice(0, 8)}`)
    }
  })

  it('identifies the native port only after opt-in with a durable public identity', async () => {
    const native = port()

    const controller = createConnectionController({
      connectNative: () => native, readOptIn: async () => false,
      readIdentity: async () => identity, writeOptIn: async () => undefined
    })

    await controller.start()
    expect(native.postMessage).not.toHaveBeenCalled()
    await controller.connect('Work')
    expect(native.postMessage).toHaveBeenCalledWith({ ...identity, type: 'bridge.identity', version: 1 })
    expect(controller.getState()).toMatchObject({ identity })
  })

  it('does not resurrect a connection when identity loading finishes after Disconnect', async () => {
    let resolveIdentity!: (value: typeof identity) => void
    const readIdentity = () => new Promise<typeof identity>(resolve => { resolveIdentity = resolve })
    const connectNative = vi.fn(() => port())

    const controller = createConnectionController({
      connectNative, readIdentity, readOptIn: async () => false, writeOptIn: async () => undefined
    })

    const connecting = controller.connect('Work')
    await vi.waitFor(() => expect(resolveIdentity).toBeDefined())
    const disconnecting = controller.disconnect()
    expect(controller.getState().optedIn).toBe(false)
    resolveIdentity(identity)
    await Promise.all([connecting, disconnecting])
    expect(connectNative).not.toHaveBeenCalled()
    expect(controller.getState().connection).toBe('disconnected')
  })
})

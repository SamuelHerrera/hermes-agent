import { type ConnectionIdentity, safeConnectionLabel, validConnectionId } from '../src/connection.js'

const IDENTITY_KEY = 'hermesChromeBridgeIdentity'

export function createIdentityStore(storage: {
  get(key: string): Promise<Record<string, unknown>>
  set(values: Record<string, unknown>): Promise<void>
}, uuid: () => string = () => crypto.randomUUID()): (label?: string) => Promise<ConnectionIdentity> {
  let queue: Promise<unknown> = Promise.resolve()

  return (label?: string) => {
    const read = queue.catch(() => undefined).then(async () => {
      const stored = (await storage.get(IDENTITY_KEY))[IDENTITY_KEY] as Partial<ConnectionIdentity> | undefined
      const connectionId = validConnectionId(stored?.connectionId) ? stored.connectionId : uuid()
      const identity = { connectionId, label: safeConnectionLabel(label ?? stored?.label, connectionId) }
      await storage.set({ [IDENTITY_KEY]: identity })

      return identity
    })

    queue = read

    return read
  }
}

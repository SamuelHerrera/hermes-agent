import type { ConnectionStatus } from './lifecycle.js'
import type { NativeRequest, NativeResponse } from './protocol.js'
import { type TabService, TabServiceError } from './tab-service.js'

interface DispatcherDependencies {
  getConnectionState(): ConnectionStatus
  tabService: TabService
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()

  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function error(id: string, code: string, message: string): NativeResponse {
  return { error: { code, message }, id, type: 'response' }
}

export function createBridgeRequestDispatcher(dependencies: DispatcherDependencies) {
  return async (request: NativeRequest): Promise<NativeResponse> => {
    try {
      if (request.method === 'status') {
        if (!exactKeys(request.arguments, [])) {
          return error(request.id, 'INVALID_ARGUMENTS', 'status does not accept arguments.')
        }

        const connected = dependencies.getConnectionState() === 'connected'

        return {
          id: request.id,
          result: {
            bridgeConnected: connected,
            nativeConnected: connected,
            ...(dependencies.tabService.getSelectedTabId() === undefined
              ? {}
              : { selectedTabId: dependencies.tabService.getSelectedTabId() })
          },
          type: 'response'
        }
      }

      if (request.method === 'tabs') {
        if (!exactKeys(request.arguments, [])) {
          return error(request.id, 'INVALID_ARGUMENTS', 'tabs does not accept arguments.')
        }

        return {
          id: request.id,
          result: {
            bridgeConnected: true,
            nativeConnected: dependencies.getConnectionState() === 'connected',
            ...await dependencies.tabService.list()
          },
          type: 'response'
        }
      }

      if (request.method === 'selectTab') {
        if (!exactKeys(request.arguments, ['tabId']) ||
          !Number.isInteger(request.arguments.tabId) ||
          (request.arguments.tabId as number) <= 0) {
          return error(
            request.id,
            'INVALID_ARGUMENTS',
            'selectTab requires exactly one positive integer tabId.'
          )
        }

        return {
          id: request.id,
          result: await dependencies.tabService.select(request.arguments.tabId as number),
          type: 'response'
        }
      }

      return error(request.id, 'METHOD_NOT_IMPLEMENTED', 'This bridge method is not implemented.')
    } catch (caught) {
      if (caught instanceof TabServiceError) {
        return error(request.id, caught.code, caught.message)
      }

      return error(request.id, 'BRIDGE_ERROR', 'The Chrome bridge request failed.')
    }
  }
}

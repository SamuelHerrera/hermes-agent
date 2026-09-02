export type BridgeMethod = 'click' | 'close' | 'console' | 'eval' | 'focus' | 'hover' | 'key' |
  'navigate' | 'open' | 'query' | 'screenshot' | 'scroll' | 'selectTab' | 'snapshot' | 'status' |
  'tabs' | 'type'

export interface NativeRequest {
  arguments: Record<string, unknown>
  id: string
  method: string
  type: 'request'
}

export interface NativeResponse {
  error?: { code: string, message: string }
  id: string
  result?: unknown
  type: 'response'
}

export type NativeRequestHandler = (request: NativeRequest) => Promise<NativeResponse>

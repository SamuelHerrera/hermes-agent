export type BridgeMethod = 'selectTab' | 'snapshot' | 'status' | 'tabs'

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

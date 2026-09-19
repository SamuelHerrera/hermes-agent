/// <reference types="vite/client" />

declare module '*terminal-host/src/session-client.mjs' {
  export function openSession(
    client: { epoch: string; request(method: string, params: unknown): Promise<unknown> },
    options: {
      scope: string
      reference?: { scope: string; epoch: string; terminalId: string }
      requestId: string
      spawn: Record<string, unknown>
    }
  ): Promise<any>
}

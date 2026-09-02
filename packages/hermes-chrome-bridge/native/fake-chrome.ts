import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'

import {
  BROWSER_TO_HOST_MAX_BYTES,
  encodeNativeMessage,
  HOST_TO_BROWSER_MAX_BYTES,
  NativeMessageDecoder
} from './framing.js'

export interface FakeChromeProcessOptions {
  configPath: string
  hostPath: string
  nodePath?: string
  origin: string
}

export class FakeChromeProcess {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly decoder = new NativeMessageDecoder(HOST_TO_BROWSER_MAX_BYTES)
  private readonly messages: unknown[] = []
  private readonly waiters: Array<(message: unknown) => void> = []

  public constructor(options: FakeChromeProcessOptions) {
    this.child = spawn(options.nodePath ?? process.execPath, [
      options.hostPath,
      options.configPath,
      options.origin
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stdout.on('data', chunk => {
      for (const message of this.decoder.push(Buffer.from(chunk))) {
        const waiter = this.waiters.shift()

        if (waiter === undefined) {this.messages.push(message)}
        else {waiter(message)}
      }
    })
  }

  public send(message: Record<string, unknown>): void {
    this.child.stdin.write(encodeNativeMessage(message, BROWSER_TO_HOST_MAX_BYTES))
  }

  public async receive(): Promise<unknown> {
    const message = this.messages.shift()

    if (message !== undefined) {return message}

    return new Promise(resolve => this.waiters.push(resolve))
  }

  public diagnostics(): NodeJS.ReadableStream {
    return this.child.stderr
  }

  public async close(): Promise<void> {
    if (this.child.exitCode !== null) {return}
    this.child.stdin.end()
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        this.child.kill('SIGTERM')
      }, 500)

      this.child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}

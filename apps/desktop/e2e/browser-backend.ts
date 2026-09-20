import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '..', '..')
const BROWSER_DIST = path.join(REPO_ROOT, 'hermes_cli', 'desktop_web_dist')

export interface BrowserBackend {
  baseUrl: string
  token: string
  cleanup(): Promise<void>
}

async function availablePort(): Promise<number> {
  const server = net.createServer()

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))

  return port
}

async function waitForBackend(baseUrl: string, token: string, process: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Browser backend exited early with code ${process.exitCode}.`)
    }

    try {
      const response = await fetch(`${baseUrl}/api/capabilities`, {
        headers: { 'X-Hermes-Session-Token': token }
      })

      if (response.ok) {
        return
      }
    } catch {
      // Server is still starting.
    }

    await new Promise(resolve => setTimeout(resolve, 100))
  }

  throw new Error('Timed out waiting for isolated browser backend.')
}

export async function startBrowserBackend(): Promise<BrowserBackend> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-browser-e2e-'))
  const hermesHome = path.join(root, 'hermes-home')
  const port = await availablePort()
  const token = 'browser-e2e-session-token'

  fs.mkdirSync(hermesHome, { recursive: true })
  fs.writeFileSync(path.join(hermesHome, 'config.yaml'), '# isolated browser E2E\n', 'utf8')

  const child = spawn(
    process.env.PYTHON ?? 'python',
    ['-m', 'uvicorn', 'hermes_cli.web_server:app', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        HERMES_DASHBOARD_SESSION_TOKEN: token,
        HERMES_DESKTOP_WEB_DIST: BROWSER_DIST,
        HERMES_HOME: hermesHome,
        // Exercise the real `hermes serve` policy: the admin dashboard stays
        // headless while the independently gated Browser Desktop remains live.
        HERMES_SERVE_HEADLESS: '1'
      },
      stdio: 'pipe'
    }
  )
  const baseUrl = `http://127.0.0.1:${port}`

  try {
    await waitForBackend(baseUrl, token, child)
  } catch (error) {
    child.kill('SIGTERM')
    fs.rmSync(root, { recursive: true, force: true })
    throw error
  }

  return {
    baseUrl,
    token,
    async cleanup() {
      if (child.exitCode === null) {
        child.kill('SIGTERM')
        await Promise.race([
          new Promise<void>(resolve => child.once('exit', () => resolve())),
          new Promise<void>(resolve => setTimeout(resolve, 3_000))
        ])
      }
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
}

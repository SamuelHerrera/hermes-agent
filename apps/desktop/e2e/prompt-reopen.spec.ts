import * as fs from 'node:fs'
import * as path from 'node:path'

import { expect, test } from '@playwright/test'

import { buildAppEnv, createSandbox, launchDesktop, waitForAppReady, writeEnvFile, writeMockProviderConfig } from './fixtures'
import { startMockServer } from './mock-server'

// A sandbox-only tool invokes the real terminal password callback. No sudo
// command runs, no password is returned as tool output, and no credential is saved.
const PLUGIN = `import json
from tools.terminal_tool import _prompt_for_sudo_password

def prompt(args, **kwargs):
    value = _prompt_for_sudo_password()
    return json.dumps({'accepted': bool(value)})

def register(ctx):
    ctx.register_tool(name='e2e_sudo_prompt', toolset='e2e_sudo',
        schema={'name': 'e2e_sudo_prompt', 'description': 'Request a synthetic test password without executing sudo.', 'parameters': {'type': 'object', 'properties': {}}},
        handler=prompt)
`

test('reopens a live sudo request after Electron quits without storing the password', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox('prompt-reopen')
  const mock = await startMockServer()
  const pluginDir = path.join(sandbox.hermesHome, 'plugins', 'e2e-sudo')
  fs.mkdirSync(pluginDir, { recursive: true })
  fs.writeFileSync(path.join(pluginDir, 'plugin.yaml'), 'name: e2e-sudo\nprovides_tools: [e2e_sudo_prompt]\n')
  fs.writeFileSync(path.join(pluginDir, '__init__.py'), PLUGIN)
  writeMockProviderConfig(sandbox.hermesHome, mock.url, undefined, 'plugins:\n  enabled: [e2e-sudo]\ntoolsets: [all]')
  writeEnvFile(sandbox.hermesHome)
  const env = buildAppEnv(sandbox)
  let desktop = await launchDesktop(env)
  let requestId = ''
  desktop.page.on('websocket', socket => socket.on('framereceived', frame => {
    try {
      const message = JSON.parse(String(frame.payload))
      if (message.params?.type === 'sudo.request') requestId = message.params.payload.request_id
    } catch { /* unrelated frame */ }
  }))
  try {
    await desktop.page.reload()
    await waitForAppReady({ ...desktop, sandbox, cleanup: async () => undefined })
    const composer = desktop.page.locator('[contenteditable="true"]').first()
    await composer.fill('E2E_SUDO_REOPEN')
    await composer.press('Enter')
    await expect(desktop.page.locator('[role="dialog"] input[type="password"]')).toBeVisible({ timeout: 45_000 })
    await expect.poll(() => requestId).not.toBe('')
    await desktop.app.close()
    desktop = await launchDesktop(env)
    let replayedId = ''
    desktop.page.on('websocket', socket => socket.on('framereceived', frame => {
      try {
        const message = JSON.parse(String(frame.payload))
        if (message.result?.pending_prompt?.event === 'sudo.request') {
          replayedId = message.result.pending_prompt.payload.request_id
        }
      } catch { /* unrelated frame */ }
    }))
    await desktop.page.reload()
    await waitForAppReady({ ...desktop, sandbox, cleanup: async () => undefined })
    const input = desktop.page.locator('[role="dialog"] input[type="password"]')
    await expect(input).toBeVisible({ timeout: 30_000 })
    // The same request ID proves this is the original live waiter, not a new turn.
    await expect.poll(() => replayedId).toBe(requestId)
    await expect(input).toHaveValue('')
    await input.fill('synthetic-e2e-only')
    await desktop.page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click()
    await expect(input).toHaveCount(0)
    await expect(desktop.page.getByText('Sudo reopen fixture finished.', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
    await desktop.page.reload()
    await waitForAppReady({ ...desktop, sandbox, cleanup: async () => undefined })
    await expect(desktop.page.locator('[role="dialog"] input[type="password"]')).toHaveCount(0)
    const storage = await desktop.page.evaluate(() => JSON.stringify(localStorage))
    expect(storage).not.toContain('synthetic-e2e-only')
  } finally {
    await desktop.app.close().catch(() => undefined)
    await mock.close()
    sandbox.cleanup()
  }
})

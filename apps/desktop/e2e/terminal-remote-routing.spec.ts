import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  selectCreateAction,
  waitForAppReady,
  writeEnvFile,
  writeMockProviderConfig,
  type MockBackendFixture
} from './fixtures'
import { startMockServer } from './mock-server'
import { expect, test, type Page } from './test'

// Opt in ONLY against a disposable, explicitly auth-disabled trusted-LAN
// backend, with profile default and terminal.cwd=/tmp. Never use the installed
// app's connection.json or credentials. No inference requests are sent.
const remoteUrl = process.env.HERMES_E2E_REMOTE_TERMINAL_URL?.trim()
const remoteHostname = process.env.HERMES_E2E_REMOTE_TERMINAL_HOSTNAME || 'hp'
const localProfile = 'terminal-local'
const remoteProfile = 'default'
const storageKey = 'hermes.desktop.terminals.v1'

interface SavedTerminal {
  id: string
  profile?: string
  reviveBuffer?: string
}

async function savedTerminal(page: Page, id: string): Promise<SavedTerminal | null> {
  return page.evaluate(
    ({ key, terminalId }) => {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as { terminals?: SavedTerminal[] }
      return saved.terminals?.find(terminal => terminal.id === terminalId) ?? null
    },
    { key: storageKey, terminalId: id }
  )
}

// Two creation orders exercise owner-bound startup with either backend primary.
// Bootstrap locally to discover both profiles before switching the foreground.
// Only inference is mocked; the renderer, preload IPC, PTYs and remote terminal
// WebSocket are real. No window.hermes overrides or terminal API mocks.
for (const initialProfile of [localProfile, remoteProfile]) {
  test(`manual terminals route by owner with ${initialProfile} primary`, async ({}, testInfo) => {
    test.skip(!remoteUrl, 'Set HERMES_E2E_REMOTE_TERMINAL_URL to the disposable HP backend to opt in')
    test.skip(process.platform !== 'darwin', 'This LAN regression compares the Mac shell with HP Linux')
    test.setTimeout(240_000)

    const endpoint = new URL(remoteUrl!)
    expect(['http:', 'https:']).toContain(endpoint.protocol)
    expect(endpoint.username).toBe('')
    expect(endpoint.password).toBe('')
    expect(endpoint.search).toBe('')
    expect(endpoint.hash).toBe('')
    const localHostname = os.hostname().split('.')[0]
    expect(remoteHostname).not.toBe(localHostname)

    const sandbox = createSandbox('terminal-remote-routing')
    const mock = await startMockServer()
    let fixture: MockBackendFixture | undefined
    try {
      writeMockProviderConfig(sandbox.hermesHome, mock.url, undefined, 'terminal:\n  cwd: /tmp\n')
      writeEnvFile(sandbox.hermesHome)
      const profileHome = path.join(sandbox.hermesHome, 'profiles', localProfile)
      fs.mkdirSync(profileHome, { recursive: true })
      for (const filename of ['config.yaml', '.env']) {
        fs.copyFileSync(path.join(sandbox.hermesHome, filename), path.join(profileHome, filename))
      }
      // Global mode stays LOCAL so terminal-local cannot inherit the HP route.
      // The default label maps directly to HP's actual default profile.
      fs.writeFileSync(
        path.join(sandbox.userDataDir, 'connection.json'),
        JSON.stringify({
          mode: 'local',
          remote: {},
          profiles: {
            [localProfile]: { mode: 'local' },
            [remoteProfile]: { mode: 'remote', url: endpoint.toString().replace(/\/$/, ''), authMode: 'token' }
          }
        }),
        { mode: 0o600 }
      )
      fs.writeFileSync(path.join(sandbox.userDataDir, 'active-profile.json'), JSON.stringify({ profile: localProfile }))
      const env = buildAppEnv(sandbox)
      // Host process overrides must not defeat this sandbox's saved routes or
      // launch a dev renderer / fake backend instead of the final built tree.
      for (const key of [
        'HERMES_DESKTOP_REMOTE_URL',
        'HERMES_DESKTOP_REMOTE_TOKEN',
        'HERMES_DESKTOP_DEV_SERVER',
        'HERMES_DESKTOP_BOOT_FAKE',
        'HERMES_DESKTOP_BOOT_FAKE_ERROR',
        'HERMES_DESKTOP_HERMES'
      ])
        delete env[key]
      const { app, page } = await launchDesktop(env)
      fixture = {
        app,
        page,
        sandbox,
        mock,
        mockUrl: mock.url,
        cleanup: async () => {
          await app.close()
        }
      }
      await waitForAppReady(fixture, 120_000)

      const tabs = page.locator('[data-tree-tab^="terminal-instance:"]')
      const tab = (id: string) => page.locator(`[data-tree-tab="terminal-instance:${id}"]`)
      const host = (id: string) => page.locator(`[data-persistent-terminal="${id}"]`)
      const selectProfile = async (name: string) => {
        await page.getByRole('button', { name: 'Profiles', exact: true }).click()
        await page.getByRole('menuitemcheckbox', { name, exact: true }).click()
        await page.getByRole('button', { name: 'Profiles', exact: true }).click()
        await expect(page.getByRole('menuitemcheckbox', { name, exact: true })).toHaveAttribute(
          'aria-checked',
          'true',
          { timeout: 30_000 }
        )
        await page.keyboard.press('Escape')
      }
      const send = async (id: string, command: string) => {
        await tab(id).click()
        await expect(host(id).locator('.xterm')).toBeVisible({ timeout: 30_000 })
        await expect(host(id).locator('[data-terminal] > .pointer-events-none')).toHaveCount(0, { timeout: 30_000 })
        await host(id).locator('textarea').focus()
        await page.keyboard.type(command)
        await page.keyboard.press('Enter')
      }
      const output = async (id: string, expected: string) => {
        await expect
          .poll(async () => (await savedTerminal(page, id))?.reviveBuffer ?? '', {
            timeout: 30_000,
            message: `Real shell output for terminal ${id}: ${expected}`
          })
          .toContain(expected)
      }
      const proveHost = async (id: string, profile: string, phase: string) => {
        const marker = `ROUTE_${phase}_${profile.replaceAll('-', '_')}`
        // Expected hostname/platform are NOT in the input, so echoing the
        // command line (or merely painting an empty xterm) cannot pass.
        await send(id, `printf '${marker}=%s/%s\\n' "$(hostname -s)" "$(uname -s)"`)
        await output(
          id,
          `${marker}=${profile === localProfile ? localHostname : remoteHostname}/${profile === localProfile ? 'Darwin' : 'Linux'}`
        )
        await send(id, `cd /tmp && printf '${marker}_CWD=%s\\n' "$(pwd -P)"`)
        await output(id, `${marker}_CWD=${profile === localProfile ? fs.realpathSync('/tmp') : '/tmp'}`)
        expect((await savedTerminal(page, id))?.profile).toBe(profile)
      }

      const ids = new Map<string, string>()
      const order = [initialProfile, initialProfile === localProfile ? remoteProfile : localProfile]
      for (const profile of order) {
        await selectProfile(profile)
        await expect(tabs).toHaveCount(0)
        // Use the visible toolbar action after the profile menu closes.
        await selectCreateAction(page, 'New terminal')
        await expect(tabs).toHaveCount(1)
        const pane = (await tabs.first().getAttribute('data-tree-tab'))!
        const id = pane.slice('terminal-instance:'.length)
        ids.set(profile, id)
        await proveHost(id, profile, 'INITIAL')
        await send(id, 'export HERMES_ROUTE_ALIVE=owner_bound')
        await send(id, 'printf \'ARMED=%s\\n\' "$HERMES_ROUTE_ALIVE"')
        await output(id, 'ARMED=owner_bound')
        await page.screenshot({ path: testInfo.outputPath(`${profile}-initial-xterm.png`) })
      }
      expect(new Set(ids.values()).size).toBe(2)
      await selectProfile('All profiles')
      await expect(tabs).toHaveCount(2)
      for (const [profile, id] of ids) {
        await send(id, 'printf \'SURVIVED=%s\\n\' "$HERMES_ROUTE_ALIVE"')
        await output(id, 'SURVIVED=owner_bound')
        await proveHost(id, profile, 'ALL')
      }

      // Restore both persisted owners while local is foreground: HP's tab must
      // neither revive as a Mac shell nor lose its owner because it is hidden.
      await selectProfile(localProfile)
      await expect(tabs).toHaveCount(1)
      await expect(tab(ids.get(localProfile)!)).toBeVisible()
      await expect(host(ids.get(remoteProfile)!)).toHaveAttribute('aria-hidden', 'true')
      await page.reload()
      await waitForAppReady(fixture, 120_000)
      await selectProfile('All profiles')
      await expect(tabs).toHaveCount(2)
      for (const [profile, id] of ids) {
        // A fresh marker after reload proves execution, not stale scrollback.
        await proveHost(id, profile, 'RESTORED')
        await page.screenshot({ path: testInfo.outputPath(`${profile}-restored-xterm.png`) })
        await testInfo.attach(`${profile}-revive-buffer`, {
          body: (await savedTerminal(page, id))?.reviveBuffer ?? '',
          contentType: 'text/plain'
        })
      }
      await selectProfile(initialProfile)
      await expect(tabs).toHaveCount(1)
      await expect(tab(ids.get(initialProfile)!)).toBeVisible()
    } finally {
      await fixture?.cleanup().catch(() => undefined)
      await mock.close()
      sandbox.cleanup()
    }
  })
}

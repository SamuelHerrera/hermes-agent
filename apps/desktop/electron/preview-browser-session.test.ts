import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  installPreviewBrowserSession,
  PREVIEW_BROWSER_PARTITION,
  shouldGrantPreviewBrowserPermission
} from './preview-browser-session'

function createFakeSession() {
  const events = new Map<string, Function>()
  let permissionRequestHandler: Function | null = null
  let permissionCheckHandler: Function | null = null
  let flushCount = 0

  const previewSession = {
    flushStorageData: async () => {
      flushCount += 1
    },
    on: (event: string, handler: Function) => {
      events.set(event, handler)
    },
    setPermissionCheckHandler: (handler: Function) => {
      permissionCheckHandler = handler
    },
    setPermissionRequestHandler: (handler: Function) => {
      permissionRequestHandler = handler
    }
  }

  return {
    events,
    get flushCount() {
      return flushCount
    },
    get permissionCheckHandler() {
      return permissionCheckHandler
    },
    get permissionRequestHandler() {
      return permissionRequestHandler
    },
    previewSession
  }
}

test('preview browser grants browser-profile permissions but denies app-launch and filesystem access', () => {
  assert.equal(shouldGrantPreviewBrowserPermission('storage-access'), true)
  assert.equal(shouldGrantPreviewBrowserPermission('top-level-storage-access'), true)
  assert.equal(shouldGrantPreviewBrowserPermission('hid'), true)
  assert.equal(shouldGrantPreviewBrowserPermission('usb'), true)
  assert.equal(shouldGrantPreviewBrowserPermission('media', { mediaTypes: ['audio'] }), true)
  assert.equal(shouldGrantPreviewBrowserPermission('media', { mediaTypes: ['video'] }), true)
  assert.equal(shouldGrantPreviewBrowserPermission('media', { mediaTypes: ['screen'] }), false)
  assert.equal(shouldGrantPreviewBrowserPermission('openExternal'), false)
  assert.equal(shouldGrantPreviewBrowserPermission('fileSystem'), false)
  assert.equal(shouldGrantPreviewBrowserPermission('display-capture'), false)
})

test('installPreviewBrowserSession wires the persistent browser profile partition', async () => {
  const fake = createFakeSession()
  const partitions: string[] = []
  const appEvents = new Map<string, Function>()
  const logs: string[] = []

  const app = {
    configureWebAuthn: (options: unknown) => {
      logs.push(`webauthn:${JSON.stringify(options)}`)
    },
    on: (event: string, handler: Function) => {
      appEvents.set(event, handler)
    }
  }

  const installed = installPreviewBrowserSession({
    app: app as never,
    platform: 'darwin',
    rememberLog: message => logs.push(message),
    sessionModule: {
      fromPartition: partition => {
        partitions.push(partition)

        return fake.previewSession as never
      }
    }
  })

  assert.equal(installed, fake.previewSession)
  assert.deepEqual(partitions, [PREVIEW_BROWSER_PARTITION])
  assert.equal(typeof fake.permissionRequestHandler, 'function')
  assert.equal(typeof fake.permissionCheckHandler, 'function')
  assert.equal(typeof fake.events.get('select-webauthn-authenticator'), 'function')
  assert.equal(typeof fake.events.get('select-webauthn-account'), 'function')
  assert.ok(logs.some(line => line.includes('platformPasskeys')))

  let requestGranted: boolean | null = null
  fake.permissionRequestHandler?.(null, 'storage-access', (granted: boolean) => {
    requestGranted = granted
  })
  assert.equal(requestGranted, true)
  assert.equal(fake.permissionCheckHandler?.(null, 'openExternal'), false)

  appEvents.get('before-quit')?.()
  await Promise.resolve()
  assert.equal(fake.flushCount, 1)
})

test('preview browser WebAuthn handlers prefer system passkeys and never guess among multiple accounts', () => {
  const fake = createFakeSession()

  installPreviewBrowserSession({
    app: { on: () => undefined } as never,
    platform: 'linux',
    sessionModule: { fromPartition: () => fake.previewSession as never }
  })

  let authenticator: string | null | undefined
  fake.events.get('select-webauthn-authenticator')?.(
    { authenticators: ['touchID', 'platformPasskeys'] },
    (selected: string | null | undefined) => {
      authenticator = selected
    }
  )
  assert.equal(authenticator, 'platformPasskeys')

  let credential: string | null | undefined
  fake.events.get('select-webauthn-account')?.(
    {},
    { accounts: [{ credentialId: 'only-one', name: 'samuel@example.com' }] },
    (selected: string | null | undefined) => {
      credential = selected
    }
  )
  assert.equal(credential, 'only-one')

  fake.events.get('select-webauthn-account')?.(
    {},
    { accounts: [{ credentialId: 'a' }, { credentialId: 'b' }] },
    (selected: string | null | undefined) => {
      credential = selected
    }
  )
  assert.equal(credential, null)
})

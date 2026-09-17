import type { Session, WebContents } from 'electron'

export const PREVIEW_BROWSER_PARTITION = 'persist:hermes-preview'

const PREVIEW_BROWSER_GRANTED_PERMISSIONS = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'geolocation',
  'hid',
  'keyboardLock',
  'mediaKeySystem',
  'midi',
  'midiSysex',
  'notifications',
  'pointerLock',
  'speaker-selection',
  'storage-access',
  'top-level-storage-access',
  'usb',
  'window-management'
])

const PREVIEW_BROWSER_DENIED_PERMISSIONS = new Set([
  // Keep native external-open decisions in Hermes' own link handling instead of
  // silently letting arbitrary sites launch other apps.
  'openExternal',
  // Do not hand a website arbitrary persistent filesystem access from the shared
  // browser profile. Users can still upload files through normal file pickers.
  'fileSystem',
  'display-capture'
])

interface PermissionDetailsLike {
  mediaTypes?: unknown
}

interface AppLike {
  configureWebAuthn?: (options: { platformPasskeys?: boolean }) => void
  on: (event: 'before-quit', handler: () => void) => unknown
}

interface WebAuthnSessionEvents {
  on: (event: string, handler: Function) => unknown
}

export interface PreviewBrowserSessionInstallerOptions {
  app: AppLike
  platform?: NodeJS.Platform
  rememberLog?: (message: string) => void
  sessionModule: {
    fromPartition(partition: string): Session
  }
}

function isMediaCapturePermission(permission: string, details?: PermissionDetailsLike): boolean {
  if (permission === 'media') {
    const mediaTypes = details?.mediaTypes

    if (!Array.isArray(mediaTypes) || mediaTypes.length === 0) {
      return true
    }

    return mediaTypes.includes('audio') || mediaTypes.includes('video')
  }

  return permission === 'audioCapture' || permission === 'videoCapture'
}

export function shouldGrantPreviewBrowserPermission(permission: string, details?: PermissionDetailsLike): boolean {
  if (PREVIEW_BROWSER_DENIED_PERMISSIONS.has(permission)) {
    return false
  }

  return isMediaCapturePermission(permission, details) || PREVIEW_BROWSER_GRANTED_PERMISSIONS.has(permission)
}

function installWebAuthnHandlers(previewSession: Session, rememberLog: (message: string) => void) {
  const webauthnSession = previewSession as unknown as WebAuthnSessionEvents

  webauthnSession.on('select-webauthn-authenticator', (event: unknown, callback: (name?: string | null) => void) => {
    const authenticators = Array.isArray((event as { authenticators?: unknown }).authenticators)
      ? ((event as { authenticators: string[] }).authenticators ?? [])
      : []

    const selected = authenticators.includes('platformPasskeys') ? 'platformPasskeys' : authenticators[0]

    callback(selected ?? null)
  })

  webauthnSession.on(
    'select-webauthn-account',
    (
      _event: unknown,
      details: { accounts?: Array<{ credentialId?: string | null; name?: string }> },
      callback: (id?: string | null) => void
    ) => {
      const accounts = Array.isArray(details?.accounts) ? details.accounts : []

      if (accounts.length === 1) {
        callback(accounts[0]?.credentialId ?? null)

        return
      }

      // Electron cancels discoverable Touch ID passkey requests when no listener
      // is installed. Cancel explicitly for ambiguous account sets rather than
      // silently choosing the wrong account; platform passkeys use the native
      // system sheet and do not route through this event.
      if (accounts.length > 1) {
        rememberLog(
          `[preview-browser] WebAuthn returned ${accounts.length} discoverable accounts; native chooser required`
        )
      }

      callback(null)
    }
  )
}

export function installPreviewBrowserSession({
  app,
  platform = process.platform,
  rememberLog = () => {},
  sessionModule
}: PreviewBrowserSessionInstallerOptions): Session {
  const previewSession = sessionModule.fromPartition(PREVIEW_BROWSER_PARTITION)

  previewSession.setPermissionRequestHandler(
    (_webContents: WebContents, permission: string, callback: (granted: boolean) => void, details?: unknown) => {
      callback(shouldGrantPreviewBrowserPermission(permission, details as PermissionDetailsLike | undefined))
    }
  )

  previewSession.setPermissionCheckHandler(
    (_webContents: WebContents | null, permission: string, _requestingOrigin: string, details?: unknown) =>
      shouldGrantPreviewBrowserPermission(permission, details as PermissionDetailsLike | undefined)
  )

  installWebAuthnHandlers(previewSession, rememberLog)

  if (platform === 'darwin' && typeof app.configureWebAuthn === 'function') {
    try {
      app.configureWebAuthn({ platformPasskeys: true })
      rememberLog('[preview-browser] enabled macOS platform passkeys for embedded browser profile')
    } catch (error) {
      rememberLog(`[preview-browser] could not enable macOS platform passkeys: ${(error as Error)?.message || error}`)
    }
  }

  app.on('before-quit', () => {
    Promise.resolve(previewSession.flushStorageData()).catch(error => {
      rememberLog(`[preview-browser] could not flush browser profile storage: ${(error as Error)?.message || error}`)
    })
  })

  return previewSession
}

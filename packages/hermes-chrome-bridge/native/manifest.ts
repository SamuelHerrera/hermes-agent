import { join } from 'node:path'

export const HOST_NAME = 'com.nous.hermes_chrome_bridge'
export const PROTOCOL_VERSION = 1

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/
const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/([a-p]{32})\/?$/

export interface NativeHostManifest {
  allowed_origins: string[]
  description: string
  name: typeof HOST_NAME
  path: string
  type: 'stdio'
}

export function originFromExtensionId(extensionId: string): string {
  if (!EXTENSION_ID_PATTERN.test(extensionId)) {
    throw new Error('invalid Chrome extension ID')
  }

  return `chrome-extension://${extensionId}/`
}

export function normalizeExtensionOrigin(origin: string): string {
  const match = EXTENSION_ORIGIN_PATTERN.exec(origin)

  if (match?.[1] === undefined) {
    throw new Error('invalid Chrome extension origin')
  }

  return `chrome-extension://${match[1]}/`
}

export function buildNativeHostManifest(
  wrapperPath: string,
  extensionOrigin: string
): NativeHostManifest {
  return {
    allowed_origins: [normalizeExtensionOrigin(extensionOrigin)],
    description: 'Hermes Chrome Bridge native messaging host',
    name: HOST_NAME,
    path: wrapperPath,
    type: 'stdio'
  }
}

export function nativeManifestPath(
  userHome: string,
  platform: NodeJS.Platform
): string {
  if (platform === 'darwin') {
    return join(
      userHome,
      'Library',
      'Application Support',
      'Google',
      'Chrome',
      'NativeMessagingHosts',
      `${HOST_NAME}.json`
    )
  }

  if (platform === 'linux') {
    return join(
      userHome,
      '.config',
      'google-chrome',
      'NativeMessagingHosts',
      `${HOST_NAME}.json`
    )
  }

  throw new Error('Windows native host installation requires a signed executable launcher')
}

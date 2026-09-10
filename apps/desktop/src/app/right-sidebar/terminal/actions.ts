import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import { getConfiguredDefaultProjectDir } from '@/store/session'

import { createTerminal } from './terminals'

/** The global command never inherits the foreground chat's directory. */
export function createDefaultTerminal(): string {
  return createTerminal(getConfiguredDefaultProjectDir(), {
    profile: normalizeProfileKey($activeGatewayProfile.get()),
    projectId: '__no_project__'
  })
}

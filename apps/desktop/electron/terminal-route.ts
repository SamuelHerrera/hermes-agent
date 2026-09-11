/** Resolve once from the tab's durable owner, never from foreground UI state. */
export async function resolveTerminalRoute(
  owner: string | undefined,
  resolveRemote: (profile: string) => Promise<any>,
  getSsh: (scope: string) => any
) {
  const profile = owner?.trim() || 'default'

  if (profile === '__all__') {
    throw new Error('A terminal requires a profile owner.')
  }
  // resolveRemote snapshots the saved connection configuration before its first await.
  const connection = await resolveRemote(profile)

  if (!connection) {
    return { kind: 'local' as const, profile }
  }

  if (connection.remoteKind !== 'ssh') {
    return { kind: 'remote' as const, profile, connection }
  }
  const scope = connection.source === 'profile' ? profile : ''
  const state = getSsh(scope)

  if (!state?.ssh) {
    throw new Error('The terminal owner SSH connection is unavailable. Try again.')
  }

  return { kind: 'ssh' as const, profile, target: { ssh: state.ssh, scope }, remotePlatform: state.remotePlatform }
}

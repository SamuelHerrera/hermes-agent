async function applyConnectionChange({
  cancelAndWait,
  isPrimary,
  rehomePrimary = null,
  scope,
  sendApplied,
  stopPool,
  teardownPrimary,
  teardownSsh
}) {
  await cancelAndWait(scope)
  await teardownSsh(scope)

  if (!isPrimary) {
    stopPool(scope)

    return
  }

  if (rehomePrimary) {
    await rehomePrimary()

    return
  }

  await teardownPrimary()
  sendApplied()
}

function commitConnectionFailure(current, starting, commit) {
  if (current !== starting) {
    return false
  }

  commit()

  return true
}

export { applyConnectionChange, commitConnectionFailure }

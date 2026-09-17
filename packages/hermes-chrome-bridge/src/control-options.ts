export const INPUT_METHODS = new Set(['click', 'hover', 'key', 'scroll', 'type', 'screenshot', 'control'])
export const INSPECTION_KEYS = ['selector', 'limit', 'cursor', 'maxChars', 'fields', 'visibleOnly', 'frameId']
export const INSPECTION_FIELDS = ['ref', 'role', 'name', 'text', 'value', 'box', 'state', 'tag']
const integer = (v: unknown, min: number, max: number) => Number.isInteger(v) && Number(v) >= min && Number(v) <= max
const text = (v: unknown, max = 2048) => typeof v === 'string' && v.length > 0 && v.length <= max

export function validInspectionOptions(a: Record<string, unknown>): boolean {
  return (a.selector === undefined || text(a.selector)) && (a.cursor === undefined || text(a.cursor, 4096)) &&
    (a.frameId === undefined || integer(a.frameId, 0, Number.MAX_SAFE_INTEGER)) &&
    (a.limit === undefined || integer(a.limit, 1, 500)) && (a.maxChars === undefined || integer(a.maxChars, 1, 240)) &&
    (a.visibleOnly === undefined || typeof a.visibleOnly === 'boolean') &&
    (a.fields === undefined || (Array.isArray(a.fields) && a.fields.length <= 8 && a.fields.every(f => INSPECTION_FIELDS.includes(f))))
}

export function validControlArguments(method: string, a: Record<string, unknown>, wire = false): boolean {
  if (!integer(a.tabId, 1, Number.MAX_SAFE_INTEGER) || (a.frameId !== undefined && !integer(a.frameId, 0, Number.MAX_SAFE_INTEGER)) ||
    (a.inputRoute !== undefined && a.inputRoute !== 'trusted' && a.inputRoute !== 'dom_event')) { return false }

  const base = ['tabId', 'frameId', 'inputRoute']
  const keys = (extra: string[]) => Object.keys(a).every(k => [...base, ...extra].includes(k))
  const point = (x: unknown, y: unknown) => [x, y].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100_000)
  const coordinate = a.x !== undefined || a.y !== undefined

  if (coordinate && (a.inputRoute === 'dom_event' || a.target !== undefined || !point(a.x, a.y))) { return false }
  const target = () => coordinate || text(a.target)

  if (method === 'click') { return keys(['target', 'x', 'y', 'button']) && target() && (a.button === undefined || ['left', 'right', 'middle'].includes(String(a.button))) }

  if (method === 'hover') { return keys(['target', 'x', 'y']) && target() }

  if (method === 'type') { return keys(['target', 'x', 'y', 'text', 'submit']) && target() && typeof a.text === 'string' && a.text.length <= 100_000 && (a.submit === undefined || typeof a.submit === 'boolean') }

  if (method === 'key') { return keys(['key', 'modifiers']) && text(a.key, 64) && (a.modifiers === undefined || (Array.isArray(a.modifiers) && a.modifiers.length <= 4 && new Set(a.modifiers).size === a.modifiers.length && a.modifiers.every(m => ['ctrl', 'alt', 'meta', 'shift'].includes(m)))) }

  if (method === 'scroll') { return keys(['target', 'x', 'y', 'deltaX', 'deltaY']) && (a.target === undefined || target()) && [a.deltaX ?? 0, a.deltaY ?? 0].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100_000) && (Number(a.deltaX ?? 0) !== 0 || Number(a.deltaY ?? 0) !== 0) }

  if (method === 'screenshot') { return keys(['format', 'quality', 'target', 'fullPage']) && (a.target === undefined || target()) && (a.fullPage === undefined || typeof a.fullPage === 'boolean') && (a.format === undefined || ['jpeg', 'png'].includes(String(a.format))) && (a.quality === undefined || (a.format === 'jpeg' && integer(a.quality, 1, 100))) }

  if (method !== 'control' || a.inputRoute === 'dom_event') { return false }
  const controlKeys = (extra: string[]) => keys(['action', ...extra])

  if (a.action === 'cancel' || a.action === 'detach' || a.action === 'dialog_inspect' || a.action === 'frames') { return controlKeys([]) }

  if (a.action === 'drag') {
    const destination = a.destinationX !== undefined || a.destinationY !== undefined
      ? a.destination === undefined && point(a.destinationX, a.destinationY) : text(a.destination)

    return controlKeys(['target', 'x', 'y', 'destination', 'destinationX', 'destinationY']) && target() && destination
  }

  if (a.action === 'dialog_accept' || a.action === 'dialog_dismiss') { return controlKeys(['dialogId', 'promptText']) && text(a.dialogId, 128) && (a.promptText === undefined || (typeof a.promptText === 'string' && a.promptText.length <= 1000)) }

  if (a.action === 'upload') {
    return controlKeys(['target', 'files', 'approvalIntent', ...(wire ? ['filePayloads'] : [])]) && target() && a.approvalIntent === 'explicit-user-approved-files' &&
      (wire ? Array.isArray(a.filePayloads) && a.filePayloads.length > 0 && a.filePayloads.length <= 8 && a.filePayloads.every(f => f && typeof f === 'object' && text(f.name, 255) && !/[\\/]/u.test(f.name) && typeof f.data === 'string' && f.data.length <= 350_000 && /^[A-Za-z0-9+/]*={0,2}$/u.test(f.data)) : Array.isArray(a.files) && a.files.length > 0 && a.files.length <= 8 && a.files.every(f => text(f, 4096)))
  }

  if (a.action === 'download') { return controlKeys(['url', 'filename', 'timeoutMs', 'maxBytes', 'approvalIntent']) && a.approvalIntent === 'explicit-user-approved-download' && text(a.url, 8192) && text(a.filename, 200) && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(String(a.filename)) && (a.timeoutMs === undefined || integer(a.timeoutMs, 100, 60_000)) && (a.maxBytes === undefined || integer(a.maxBytes, 1, 20_000_000)) }

  return false
}

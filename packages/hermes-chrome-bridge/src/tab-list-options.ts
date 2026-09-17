export const TAB_LIST_PROPERTIES = {
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  offset: { type: 'integer', minimum: 0, maximum: 100000, default: 0 },
  search: { type: 'string', maxLength: 240, description: 'Filter redacted title and URL before paging.' }
} as const

export function validTabListOptions(args: Record<string, unknown>): boolean {
  return Object.keys(args).every(key => key in TAB_LIST_PROPERTIES) &&
    (args.limit === undefined || Number.isInteger(args.limit) && Number(args.limit) >= 1 && Number(args.limit) <= 100) &&
    (args.offset === undefined || Number.isInteger(args.offset) && Number(args.offset) >= 0 && Number(args.offset) <= 100000) &&
    (args.search === undefined || typeof args.search === 'string' && args.search.length <= 240)
}

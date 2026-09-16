import { describe, expect, it } from 'vitest'

import { en } from '@/i18n/en'
import type { EnvVarInfo } from '@/types/hermes'

import { groupToolCredentials, matchesToolQuery } from './tool-credential-groups'

const info: EnvVarInfo = {
  advanced: false,
  category: 'tool',
  description: 'A service setting',
  is_password: false,
  is_set: false,
  redacted_value: null,
  tools: [],
  url: null
}

describe('tool service metadata', () => {
  it('keeps gateway overrides together and names services separately from descriptions', () => {
    const groups = groupToolCredentials({
      TOOL_GATEWAY_DOMAIN: info,
      FIRECRAWL_GATEWAY_URL: info,
      FIRECRAWL_API_KEY: info,
      AGENT_BROWSER_ENGINE: info,
      BRAVE_SEARCH_API_KEY: info
    }, en.settings.toolCredentials)

    const gateway = groups.find(group => group.name === 'Nous Tool Gateway')!
    expect(gateway.entries.map(([key]) => key)).toEqual(['TOOL_GATEWAY_DOMAIN', 'FIRECRAWL_GATEWAY_URL'])
    expect(gateway.description).not.toBe(gateway.name)
    expect(groups.find(group => group.name === 'Local Browser')?.description).toContain('Chrome')
    expect(groups.find(group => group.name === 'Brave Search')?.description).toBe('Web search.')
  })

  it('preserves every eligible key exactly once including unknown services', () => {
    const vars = {
      FIRECRAWL_API_KEY: info,
      FIRECRAWL_API_URL: info,
      FUTURE_API_KEY: { ...info, description: 'New capability' },
      FUTURE_API_URL: info,
      PROVIDER_API_KEY: { ...info, category: 'provider' },
      CHANNEL_API_KEY: { ...info, channel_managed: true }
    }

    const groups = groupToolCredentials(vars, en.settings.toolCredentials)
    const keys = groups.flatMap(group => group.entries.map(([key]) => key))
    expect(keys.sort()).toEqual(['FIRECRAWL_API_KEY', 'FIRECRAWL_API_URL', 'FUTURE_API_KEY', 'FUTURE_API_URL'])
    expect(new Set(keys).size).toBe(keys.length)
    expect(groups.filter(group => group.entries.some(([key]) => key.startsWith('FUTURE_')))).toHaveLength(2)
    expect(groups.filter(group => matchesToolQuery(group, '  NEW CAPABILITY  '))).toHaveLength(1)
  })
})

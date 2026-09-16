import type { Translations } from '@/i18n/types'
import { Activity, Brain, Globe, type IconComponent, ImageIcon, KeyRound, Mic, Search } from '@/lib/icons'
import type { EnvVarInfo } from '@/types/hermes'

import { prettyName } from './helpers'

// Service boundaries checked against hermes_cli/config_defaults.py ENV_VARS and
// https://hermes-agent.nousresearch.com/docs/user-guide/features/tools/ .
// In particular: GitHub is Skills Hub; BRV is ByteRover; TOOL_GATEWAY is shared
// Nous subscriber routing, not a Firecrawl credential. Local browsing needs no key.
// Only known prefixes group. Unknown keys get individual, lossless fallback cards.
const SERVICES = [
  ['EXA_', 'Exa', 'search', Search],
  ['PARALLEL_', 'Parallel', 'search', Search],
  ['FIRECRAWL_', 'Firecrawl', 'firecrawl', Globe],
  ['TOOL_GATEWAY_', 'gateway', 'gateway', Globe],
  ['TAVILY_', 'Tavily', 'search', Search],
  ['SEARXNG_', 'SearXNG', 'selfHostedSearch', Search],
  ['BRAVE_SEARCH_', 'Brave Search', 'searchOnly', Search],
  ['BROWSERBASE_', 'Browserbase', 'cloudBrowser', Globe],
  ['BROWSER_USE_', 'Browser Use', 'cloudBrowser', Globe],
  ['AGENT_BROWSER_', 'localBrowser', 'localBrowser', Globe],
  ['CAMOFOX_', 'Camofox', 'camofox', Globe],
  ['FAL_', 'fal.ai', 'media', ImageIcon],
  ['KREA_', 'Krea', 'images', ImageIcon],
  ['VOICE_TOOLS_OPENAI_', 'OpenAI · Whisper / TTS', 'voice', Mic],
  ['ELEVENLABS_', 'ElevenLabs', 'voice', Mic],
  ['MISTRAL_', 'Mistral · Voxtral', 'voice', Mic],
  ['PORCUPINE_', 'Picovoice · Porcupine', 'wakeWord', Mic],
  ['GITHUB_', 'GitHub', 'skillsHub', KeyRound],
  ['HONCHO_', 'Honcho', 'memory', Brain],
  ['HINDSIGHT_', 'Hindsight', 'memory', Brain],
  ['SUPERMEMORY_', 'Supermemory', 'memory', Brain],
  ['MEM0_', 'Mem0', 'memory', Brain],
  ['RETAINDB_', 'RetainDB', 'memory', Brain],
  ['BRV_', 'ByteRover', 'memory', Brain],
  ['OPENVIKING_', 'OpenViking', 'memory', Brain],
  ['HERMES_LANGFUSE_', 'Langfuse', 'telemetry', Activity]
] as const

export interface ToolCredentialGroup {
  id: string
  name: string
  description: string
  icon: IconComponent
  entries: [string, EnvVarInfo][]
}

export function groupToolCredentials(
  vars: Record<string, EnvVarInfo>,
  copy: Translations['settings']['toolCredentials']
): ToolCredentialGroup[] {
  const groups = new Map<string, ToolCredentialGroup>()

  for (const [key, info] of Object.entries(vars)) {
    if (info.category !== 'tool' || info.channel_managed) {
      continue
    }

    const service = SERVICES.find(([prefix]) =>
      key === 'FIRECRAWL_GATEWAY_URL' ? prefix === 'TOOL_GATEWAY_' : key.startsWith(prefix)
    )

    const id = service?.[0] ?? key
    let group = groups.get(id)

    if (!group) {
      const label = service?.[1]
      group = {
        id,
        name:
          label === 'gateway'
            ? copy.gatewayName
            : label === 'localBrowser'
              ? copy.localBrowserName
              : (label ?? prettyName(key.toLowerCase())),
        description: service ? copy.descriptions[service[2]] : info.description,
        icon: service?.[3] ?? KeyRound,
        entries: []
      }
      groups.set(id, group)
    }

    group.entries.push([key, info])
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function matchesToolQuery(group: ToolCredentialGroup, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()

  return [group.name, group.description, ...group.entries.flatMap(([key, info]) => [key, info.description])].some(
    text => text.toLocaleLowerCase().includes(needle)
  )
}

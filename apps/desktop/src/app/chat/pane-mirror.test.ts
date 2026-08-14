import { atom } from 'nanostores'
import { afterEach, describe, expect, it } from 'vitest'

import { $registryVersion, registry } from '@/contrib/registry'

import { paneMirror } from './pane-mirror'

type PreviewContributionData = { tabPreview?: () => boolean }

interface TestTile {
  preview?: boolean
  storedSessionId: string
}

describe('paneMirror', () => {
  const source = atom<TestTile[]>([])

  afterEach(() => {
    source.set([])
  })

  it('notifies pane chrome when preview state changes without a title change', () => {
    paneMirror<TestTile>({
      source,
      key: t => t.storedSessionId,
      prefix: 'pane-mirror-test',
      minWidth: '1rem',
      title: () => 'Same title',
      tabPreview: id => source.get().some(t => t.storedSessionId === id && t.preview),
      render: () => null,
      close: () => undefined
    })()

    source.set([{ preview: true, storedSessionId: 's1' }])
    const versionAfterOpen = $registryVersion.get()
    expect((registry.getArea('panes').find(c => c.id === 'pane-mirror-test:s1')?.data as PreviewContributionData)?.tabPreview?.()).toBe(true)

    source.set([{ preview: false, storedSessionId: 's1' }])

    expect($registryVersion.get()).toBeGreaterThan(versionAfterOpen)
    expect((registry.getArea('panes').find(c => c.id === 'pane-mirror-test:s1')?.data as PreviewContributionData)?.tabPreview?.()).toBe(false)
  })
})
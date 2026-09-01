import { describe, expect, it, vi } from 'vitest'

import { createControlIndicator } from './control-indicator.js'

class FakeNode {
  public readonly attributes = new Map<string, string>()
  public readonly children: FakeNode[] = []
  public hidden = false
  public shadow?: FakeNode
  public readonly style: Record<string, string> = {}
  public textContent = ''

  public append(...nodes: FakeNode[]): void { this.children.push(...nodes) }
  public attachShadow(): ShadowRoot {
    this.shadow = new FakeNode()

    return this.shadow as unknown as ShadowRoot
  }
  public remove = vi.fn()
  public setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
}

class FakeDocument {
  public readonly created: FakeNode[] = []
  public readonly documentElement = new FakeNode()

  public createElement(): HTMLElement {
    const node = new FakeNode()
    this.created.push(node)

    return node as unknown as HTMLElement
  }
}

describe('visible Hermes control indicator', () => {
  it('shows at an action target, dims after inactivity, and hides explicitly', () => {
    const document = new FakeDocument()
    let idle: (() => void) | undefined
    const clearTimeout = vi.fn()

    const indicator = createControlIndicator(document as unknown as Document, {
      idleMs: 1_000,
      timer: {
        clearTimeout,
        setTimeout(callback) {
          idle = callback

          return 7 as unknown as ReturnType<typeof setTimeout>
        }
      }
    })

    const target = {
      getBoundingClientRect: () => ({ height: 20, width: 40, x: 100, y: 50 })
    } as Element

    indicator.activity(target)

    const host = document.documentElement.children[0] as FakeNode
    const [, root] = host.shadow?.children ?? []
    const label = root?.children[0]?.children[1]
    const cursor = root?.children[1]

    expect(label?.textContent).toBe('Hermes is controlling Chrome')
    expect(host.hidden).toBe(false)
    expect(cursor?.style.transform).toContain('120px, 60px')
    expect(root?.style.opacity).toBe('1')

    indicator.activity(target)
    expect(clearTimeout).toHaveBeenCalled()
    expect(document.documentElement.children).toHaveLength(1)

    idle?.()
    expect(root?.style.opacity).toBe('0.35')

    indicator.hide()
    expect(host.hidden).toBe(true)
  })
})

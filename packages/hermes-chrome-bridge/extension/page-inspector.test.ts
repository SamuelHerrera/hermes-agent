import { describe, expect, it } from 'vitest'

import { createPageInspector, PageInspectorError } from './page-inspector.js'

interface FakeElementOptions {
  attributes?: Record<string, string>
  height?: number
  tagName: string
  text?: string
  value?: string
  width?: number
  x?: number
  y?: number
}

class FakeElement {
  public readonly attributes: Record<string, string>
  public readonly tagName: string
  public readonly textContent: string
  public readonly value?: string
  private readonly rectangle: { height: number, width: number, x: number, y: number }

  public constructor(options: FakeElementOptions) {
    this.attributes = options.attributes ?? {}
    this.tagName = options.tagName.toUpperCase()
    this.textContent = options.text ?? ''
    this.value = options.value
    this.rectangle = {
      height: options.height ?? 24,
      width: options.width ?? 100,
      x: options.x ?? 0,
      y: options.y ?? 0
    }
  }

  public getAttribute(name: string): string | null {
    return this.attributes[name] ?? null
  }

  public getBoundingClientRect(): DOMRect {
    return this.rectangle as DOMRect
  }

  public hasAttribute(name: string): boolean {
    return name in this.attributes
  }
}

class FakeDocument {
  public constructor(private readonly elements: FakeElement[]) {}

  public querySelectorAll(selector: string): NodeListOf<Element> {
    if (selector === '!!!invalid') { throw new DOMException('invalid selector') }

    const normalized = selector.toUpperCase()

    const selected = selector === '*'
      ? this.elements
      : this.elements.filter(element => element.tagName === normalized)

    return selected as unknown as NodeListOf<Element>
  }
}

describe('safe page inspector', () => {
  it('returns useful accessibility and DOM metadata with stable refs and bounds', () => {
    const button = new FakeElement({
      attributes: { 'aria-label': 'Submit order' },
      height: 30,
      tagName: 'button',
      text: 'Submit',
      width: 120,
      x: 10,
      y: 20
    })

    const input = new FakeElement({
      attributes: { name: 'nickname', type: 'text' },
      tagName: 'input',
      value: 'Hermes fan'
    })

    const inspector = createPageInspector(new FakeDocument([button, input]) as unknown as Document)

    const snapshot = inspector.snapshot({ format: 'both' })
    const query = inspector.query({ limit: 1, selector: 'button' })

    expect(snapshot).toMatchObject({ count: 2, format: 'both', truncated: false, version: 1 })
    expect(snapshot.elements[0]).toMatchObject({
      boundingBox: { height: 30, width: 120, x: 10, y: 20 },
      name: 'Submit order',
      role: 'button',
      tag: 'button',
      text: 'Submit'
    })
    expect(snapshot.elements[1]).toMatchObject({ role: 'textbox', value: 'Hermes fan' })
    expect(query.elements[0]?.ref).toBe(snapshot.elements[0]?.ref)
  })

  it('redacts sensitive field values and credential-like text', () => {
    const password = new FakeElement({
      attributes: { autocomplete: 'current-password', name: 'password', type: 'password' },
      tagName: 'input',
      value: 'never-return-this-secret'
    })

    const tokenText = new FakeElement({
      tagName: 'div',
      text: 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456'
    })

    const inspector = createPageInspector(new FakeDocument([password, tokenText]) as unknown as Document)

    const serialized = JSON.stringify(inspector.snapshot({ format: 'both' }))

    expect(serialized).not.toContain('never-return-this-secret')
    expect(serialized).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456')
    expect(serialized).toContain('[redacted]')
    expect(inspector.snapshot({ format: 'both' }).elements[0]).toMatchObject({ sensitive: true })
  })

  it('bounds results and reports invalid selectors without leaking selector text', () => {
    const elements = Array.from({ length: 5 }, (_, index) => new FakeElement({
      tagName: 'button',
      text: `Button ${index}`
    }))

    const inspector = createPageInspector(
      new FakeDocument(elements) as unknown as Document,
      { maxElements: 3 }
    )

    expect(inspector.snapshot({ format: 'accessibility' })).toMatchObject({
      count: 3,
      truncated: true
    })
    expect(() => inspector.query({ limit: 10, selector: '!!!invalid' })).toThrowError(PageInspectorError)

    try {
      inspector.query({ limit: 10, selector: '!!!invalid' })
    } catch (error) {
      expect((error as PageInspectorError).code).toBe('INVALID_SELECTOR')
      expect((error as Error).message).not.toContain('!!!invalid')
    }
  })
})

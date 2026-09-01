import { describe, expect, it, vi } from 'vitest'

import { createPageActions, PageActionError } from './page-actions.js'
import { createPageInspector } from './page-inspector.js'

class FakeElement {
  public readonly clicked = vi.fn()
  public readonly dispatched: Event[] = []
  public readonly focused = vi.fn()
  public readonly scrolled = vi.fn()
  public textContent = ''
  public value = ''

  public constructor(
    public readonly tagName: string,
    private readonly attributes: Record<string, string> = {},
    private readonly form?: { requestSubmit(): void }
  ) {}

  public click(): void { this.clicked() }
  public closest(selector: string): { requestSubmit(): void } | null {
    return selector === 'form' ? this.form ?? null : null
  }
  public dispatchEvent(event: Event): boolean {
    this.dispatched.push(event)

    return true
  }
  public focus(): void { this.focused() }
  public getAttribute(name: string): string | null { return this.attributes[name] ?? null }
  public getBoundingClientRect(): DOMRect {
    return { height: 20, width: 100, x: 0, y: 0 } as DOMRect
  }
  public hasAttribute(name: string): boolean { return name in this.attributes }
  public scrollBy(options: ScrollToOptions): void { this.scrolled(options) }
}

class FakeDocument {
  public activeElement?: FakeElement
  public body?: FakeElement

  public constructor(private readonly elements: FakeElement[]) {
    this.body = elements[0]
  }

  public querySelector(selector: string): Element | null {
    if (selector === '!!!invalid') { throw new DOMException('bad selector') }

    return selector === 'input' ? this.elements.find(element => element.tagName === 'INPUT') as unknown as Element : null
  }

  public querySelectorAll(): NodeListOf<Element> {
    return this.elements as unknown as NodeListOf<Element>
  }
}

describe('safe page actions', () => {
  it('clicks and types through stable refs without returning typed text', () => {
    const submitted = vi.fn()
    const input = new FakeElement('INPUT', { name: 'nickname', type: 'text' }, { requestSubmit: submitted })
    const document = new FakeDocument([input])
    const inspector = createPageInspector(document as unknown as Document)
    const ref = inspector.snapshot({ format: 'both' }).elements[0]?.ref as string
    const indicator = { activity: vi.fn(), destroy: vi.fn(), hide: vi.fn(), refresh: vi.fn() }
    const actions = createPageActions(document as unknown as Document, inspector, undefined, indicator)

    expect(actions.click({ button: 'left', target: ref })).toEqual({ clicked: true, ref })
    expect(input.clicked).toHaveBeenCalledOnce()

    const typed = actions.type({ submit: true, target: ref, text: 'Hermes fan' })

    expect(typed).toEqual({ ref, submitted: true, typedLength: 10 })
    expect(input.value).toBe('Hermes fan')
    expect(input.focused).toHaveBeenCalledOnce()
    expect(input.dispatched.map(event => event.type)).toEqual(['input', 'change'])
    expect(submitted).toHaveBeenCalledOnce()
    expect(JSON.stringify(typed)).not.toContain('Hermes fan')
    expect(indicator.activity).toHaveBeenCalledTimes(2)
    expect(indicator.activity).toHaveBeenCalledWith(input)
  })

  it('blocks typing into password, payment, and one-time-code fields', () => {
    const sensitiveAttributes: Array<Record<string, string>> = [
      { name: 'password', type: 'password' },
      { autocomplete: 'cc-number', name: 'card' },
      { autocomplete: 'one-time-code', name: 'otp' }
    ]

    for (const attributes of sensitiveAttributes) {
      const input = new FakeElement('INPUT', attributes)
      const document = new FakeDocument([input])
      const inspector = createPageInspector(document as unknown as Document)
      const ref = inspector.snapshot({ format: 'both' }).elements[0]?.ref as string
      const actions = createPageActions(document as unknown as Document, inspector)

      expect(() => actions.type({ submit: false, target: ref, text: 'never type this' }))
        .toThrowError(PageActionError)
      expect(input.value).toBe('')
    }
  })

  it('dispatches bounded keyboard, hover, and scroll actions', () => {
    const submitted = vi.fn()
    const element = new FakeElement('INPUT', { type: 'text' }, { requestSubmit: submitted })
    const document = new FakeDocument([element])
    document.activeElement = element
    const inspector = createPageInspector(document as unknown as Document)
    const ref = inspector.snapshot({ format: 'both' }).elements[0]?.ref as string
    const scrollWindow = { scrollBy: vi.fn() }

    const actions = createPageActions(
      document as unknown as Document,
      inspector,
      scrollWindow as unknown as Window
    )

    expect(actions.key({ key: 'Enter', modifiers: [] })).toEqual({ key: 'Enter', pressed: true })
    expect(actions.hover({ target: ref })).toEqual({ hovered: true, ref })
    expect(actions.scroll({ deltaX: 5, deltaY: 20, target: ref })).toEqual({ ref, scrolled: true })
    expect(actions.scroll({ deltaX: 0, deltaY: 50 })).toEqual({ scrolled: true })
    expect(element.dispatched.map(event => event.type)).toEqual(['keydown', 'keyup', 'mouseover', 'mousemove'])
    expect(submitted).toHaveBeenCalledOnce()
    expect(element.scrolled).toHaveBeenCalledWith({ behavior: 'auto', left: 5, top: 20 })
    expect(scrollWindow.scrollBy).toHaveBeenCalledWith({ behavior: 'auto', left: 0, top: 50 })
  })

  it('returns safe not-found and invalid-selector errors', () => {
    const document = new FakeDocument([])
    const inspector = createPageInspector(document as unknown as Document)
    const actions = createPageActions(document as unknown as Document, inspector)

    for (const target of ['missing', '!!!invalid']) {
      try {
        actions.click({ button: 'left', target })
        throw new Error('expected action failure')
      } catch (error) {
        expect(error).toBeInstanceOf(PageActionError)
        expect((error as Error).message).not.toContain(target)
      }
    }
  })
})

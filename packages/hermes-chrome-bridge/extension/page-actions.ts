import { type PageInspector, PageInspectorError } from './page-inspector.js'

export class PageActionError extends Error {
  public constructor(
    public readonly code: 'ACTION_FAILED' | 'ELEMENT_NOT_EDITABLE' | 'ELEMENT_NOT_FOUND' |
      'INVALID_ACTION' | 'INVALID_SELECTOR' | 'SENSITIVE_FIELD',
    message: string
  ) {
    super(message)
    this.name = 'PageActionError'
  }
}

export interface PageActions {
  click(options: { button: 'left' | 'middle' | 'right', target: string }): { clicked: true, ref: string }
  hover(options: { target: string }): { hovered: true, ref: string }
  key(options: {
    key: string
    modifiers: Array<'alt' | 'ctrl' | 'meta' | 'shift'>
  }): { key: string, pressed: true }
  scroll(options: {
    deltaX: number
    deltaY: number
    target?: string
  }): { ref?: string, scrolled: true }
  type(options: {
    submit: boolean
    target: string
    text: string
  }): { ref: string, submitted: boolean, typedLength: number }
}

function eventFor(document: Document, type: string, init: EventInit = { bubbles: true }): Event {
  const EventConstructor = document.defaultView?.Event ?? Event

  return new EventConstructor(type, init)
}

function keyboardEventFor(
  document: Document,
  type: string,
  key: string,
  modifiers: Array<'alt' | 'ctrl' | 'meta' | 'shift'>
): Event {
  const EventConstructor = document.defaultView?.KeyboardEvent

  if (EventConstructor === undefined) { return eventFor(document, type) }

  return new EventConstructor(type, {
    altKey: modifiers.includes('alt'),
    bubbles: true,
    cancelable: true,
    ctrlKey: modifiers.includes('ctrl'),
    key,
    metaKey: modifiers.includes('meta'),
    shiftKey: modifiers.includes('shift')
  })
}

function mouseEventFor(document: Document, type: string, button = 0): Event {
  const EventConstructor = document.defaultView?.MouseEvent

  if (EventConstructor === undefined) { return eventFor(document, type) }

  return new EventConstructor(type, { bubbles: true, button, cancelable: true, view: document.defaultView })
}

function translate(error: unknown): never {
  if (error instanceof PageInspectorError) {
    throw new PageActionError(error.code, error.message)
  }

  if (error instanceof PageActionError) { throw error }

  throw new PageActionError('ACTION_FAILED', 'The page action failed.')
}

export function createPageActions(
  document: Document,
  inspector: PageInspector,
  pageWindow?: Window
): PageActions {
  const resolve = (target: string) => {
    try {
      return inspector.resolve(target)
    } catch (error) {
      translate(error)
    }
  }

  return {
    click({ button, target }) {
      try {
        const resolved = resolve(target)
        const clickable = resolved.element as HTMLElement

        if (button === 'left' && typeof clickable.click === 'function') {
          clickable.click()
        } else {
          const buttonNumber = button === 'middle' ? 1 : 2

          clickable.dispatchEvent(mouseEventFor(document, 'mousedown', buttonNumber))
          clickable.dispatchEvent(mouseEventFor(document, 'mouseup', buttonNumber))
          clickable.dispatchEvent(mouseEventFor(document, 'click', buttonNumber))
        }

        return { clicked: true, ref: resolved.ref }
      } catch (error) {
        translate(error)
      }
    },

    hover({ target }) {
      try {
        const resolved = resolve(target)

        resolved.element.dispatchEvent(mouseEventFor(document, 'mouseover'))
        resolved.element.dispatchEvent(mouseEventFor(document, 'mousemove'))

        return { hovered: true, ref: resolved.ref }
      } catch (error) {
        translate(error)
      }
    },

    key({ key, modifiers }) {
      if (key.length === 0 || key.length > 64) {
        throw new PageActionError('INVALID_ACTION', 'The requested key is invalid.')
      }

      const target = document.activeElement ?? document.body

      if (target === null) {
        throw new PageActionError('ELEMENT_NOT_FOUND', 'No page element can receive the key action.')
      }

      const continueDefault = target.dispatchEvent(keyboardEventFor(document, 'keydown', key, modifiers))

      if (continueDefault && key === 'Enter' &&
        !modifiers.includes('alt') && !modifiers.includes('ctrl') && !modifiers.includes('meta')) {
        const form = (target as Element).closest?.('form') as HTMLFormElement | null | undefined

        if (typeof form?.requestSubmit === 'function') {
          form.requestSubmit()
        } else if (typeof (target as HTMLElement).click === 'function') {
          (target as HTMLElement).click()
        }
      }

      target.dispatchEvent(keyboardEventFor(document, 'keyup', key, modifiers))

      return { key, pressed: true }
    },

    scroll({ deltaX, deltaY, target }) {
      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) ||
        Math.abs(deltaX) > 100_000 || Math.abs(deltaY) > 100_000) {
        throw new PageActionError('INVALID_ACTION', 'The requested scroll distance is invalid.')
      }

      const options = { behavior: 'auto' as const, left: deltaX, top: deltaY }

      if (target === undefined) {
        const scrollingContext = pageWindow ?? document.defaultView

        if (scrollingContext === null || scrollingContext === undefined) {
          throw new PageActionError('ACTION_FAILED', 'The page cannot be scrolled.')
        }

        scrollingContext.scrollBy(options)

        return { scrolled: true }
      }

      try {
        const resolved = resolve(target)
        const scrollable = resolved.element as Element & { scrollBy?: (options: ScrollToOptions) => void }

        if (typeof scrollable.scrollBy !== 'function') {
          throw new PageActionError('ACTION_FAILED', 'The requested element cannot be scrolled.')
        }

        scrollable.scrollBy(options)

        return { ref: resolved.ref, scrolled: true }
      } catch (error) {
        translate(error)
      }
    },

    type({ submit, target, text }) {
      if (text.length > 100_000) {
        throw new PageActionError('INVALID_ACTION', 'The requested text is too large.')
      }

      try {
        const resolved = resolve(target)

        if (resolved.sensitive) {
          throw new PageActionError('SENSITIVE_FIELD', 'Typing into this sensitive field is blocked.')
        }

        const editable = resolved.element as HTMLElement & { value?: unknown }

        if (typeof editable.focus === 'function') { editable.focus() }

        if (typeof editable.value === 'string') {
          editable.value = text
        } else if (editable.isContentEditable) {
          editable.textContent = text
        } else {
          throw new PageActionError('ELEMENT_NOT_EDITABLE', 'The requested element is not editable.')
        }

        editable.dispatchEvent(eventFor(document, 'input'))
        editable.dispatchEvent(eventFor(document, 'change'))

        let submitted = false

        if (submit) {
          const form = editable.closest('form') as HTMLFormElement | null

          if (form !== null && typeof form.requestSubmit === 'function') {
            form.requestSubmit()
            submitted = true
          } else {
            editable.dispatchEvent(keyboardEventFor(document, 'keydown', 'Enter', []))
            editable.dispatchEvent(keyboardEventFor(document, 'keyup', 'Enter', []))
            submitted = true
          }
        }

        return { ref: resolved.ref, submitted, typedLength: text.length }
      } catch (error) {
        translate(error)
      }
    }
  }
}

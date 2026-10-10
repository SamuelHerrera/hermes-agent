import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { watchTerminalWebglSizing } from './webgl-sizing'

let canvas: HTMLCanvasElement
let term: Pick<Terminal, 'element'>
let dispose: (() => void) | undefined

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('devicePixelRatio', 2.625)
  const element = document.createElement('div')
  const screen = document.createElement('div')
  screen.className = 'xterm-screen'
  canvas = document.createElement('canvas')
  canvas.style.width = '376px'
  canvas.style.height = '765px'
  canvas.width = 987
  canvas.height = 2008
  screen.append(canvas)
  element.append(screen)
  document.body.append(element)
  term = { element }
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('WebGL backing-canvas sizing', () => {
  it('keeps correctly scaled WebGL, including fractional DPR rounding', () => {
    const fallback = vi.fn()
    dispose = watchTerminalWebglSizing(term, fallback).dispose
    vi.advanceTimersByTime(20)
    expect(fallback).not.toHaveBeenCalled()
  })
  it('falls back once when a device-pixel observer shrinks backing pixels to CSS pixels', async () => {
    const fallback = vi.fn()
    dispose = watchTerminalWebglSizing(term, fallback).dispose
    vi.advanceTimersByTime(20)
    canvas.width = 376
    canvas.height = 765
    await Promise.resolve()
    vi.advanceTimersByTime(20)
    expect(fallback).toHaveBeenCalledOnce()
    canvas.width = 375
    await Promise.resolve()
    vi.advanceTimersByTime(20)
    expect(fallback).toHaveBeenCalledOnce()
  })
  it('does not mistake a zero-sized hidden canvas for invalid WebGL', () => {
    canvas.style.width = '0px'
    canvas.style.height = '0px'
    const fallback = vi.fn()
    dispose = watchTerminalWebglSizing(term, fallback).dispose
    vi.advanceTimersByTime(20)
    expect(fallback).not.toHaveBeenCalled()
  })
  it('does not trigger fallback after the terminal is disposed', () => {
    canvas.width = 376
    const fallback = vi.fn()
    watchTerminalWebglSizing(term, fallback).dispose()
    vi.advanceTimersByTime(20)
    expect(fallback).not.toHaveBeenCalled()
  })
})

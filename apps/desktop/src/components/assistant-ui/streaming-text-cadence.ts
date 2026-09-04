import { useEffect, useLayoutEffect, useReducer, useRef } from 'react'

/** Long streaming Markdown is expensive to parse and reconcile at transport cadence.
 * Keep ordinary answers fully live, then cap only small appends to a large,
 * already-visible message. Large catch-ups, rewrites, and final state bypass the
 * buffer so visibility changes and turn completion remain immediate. */
export const STREAMING_TEXT_CADENCE_MS = 66
export const STREAMING_TEXT_THRESHOLD_CHARS = 8_192
export const STREAMING_TEXT_CATCHUP_CHARS = 4_096

export function useStreamingTextCadence(text: string, isRunning: boolean): string {
  const renderedRef = useRef(text)
  const pendingRef = useRef(text)
  const timerRef = useRef<number | null>(null)
  const lastCommitAtRef = useRef(0)
  const bufferingRef = useRef(false)
  const [, forceRender] = useReducer(version => version + 1, 0)

  const growth = text.length - renderedRef.current.length
  const bufferAppend =
    isRunning &&
    text.length >= STREAMING_TEXT_THRESHOLD_CHARS &&
    growth > 0 &&
    growth <= STREAMING_TEXT_CATCHUP_CHARS &&
    text.startsWith(renderedRef.current)
  const visibleText = bufferAppend ? renderedRef.current : text

  useLayoutEffect(() => {
    pendingRef.current = text
    bufferingRef.current = bufferAppend

    if (!bufferAppend) {
      renderedRef.current = text
      lastCommitAtRef.current = performance.now()

      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }

      return
    }

    if (timerRef.current !== null) {
      return
    }

    const elapsed = performance.now() - lastCommitAtRef.current
    const delay = Math.max(0, STREAMING_TEXT_CADENCE_MS - elapsed)

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null

      if (!bufferingRef.current) {
        return
      }

      renderedRef.current = pendingRef.current
      lastCommitAtRef.current = performance.now()
      forceRender()
    }, delay)
  }, [bufferAppend, text])

  useEffect(
    () => () => {
      bufferingRef.current = false

      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    },
    []
  )

  return visibleText
}

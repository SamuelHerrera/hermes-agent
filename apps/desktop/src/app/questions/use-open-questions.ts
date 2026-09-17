import { useCallback, useEffect, useRef, useState } from 'react'

import type { HermesGateway } from '@/hermes'

import type { Question } from './question-row'

export function useOpenQuestions(gateway: HermesGateway | null, profile: string | null, offset: number) {
  const [snapshot, setSnapshot] = useState<{
    gateway: HermesGateway
    profile: string | null
    questions: Question[]
    open_count: number
  } | null>(null)

  const [error, setError] = useState('')
  const { current: generation } = useRef({ value: 0 })

  const refresh = useCallback(async () => {
    const token = ++generation.value

    if (!gateway) {
      return
    }

    try {
      const response = await gateway.request<{ questions: Question[]; open_count?: number }>('questions.list', {
        profile,
        limit: 50,
        offset
      })

      if (token === generation.value) {
        setSnapshot({ ...response, open_count: response.open_count ?? response.questions.length, gateway, profile })
        setError('')
      }
    } catch (err) {
      if (token === generation.value) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
  }, [gateway, profile, offset, generation])

  useEffect(() => {
    setError('')
    void refresh()

    const offEvent = gateway?.onEvent(event => {
      if (event.type === 'questions.changed' || event.type === 'clarify.request') {
        void refresh()
      }
    })

    const offState = gateway?.onState(state => {
      if (state === 'open') {
        void refresh()
      }
    })

    // Other clients may answer while this client has no subscribed chat.
    const timer = gateway ? window.setInterval(() => void refresh(), 30_000) : undefined

    return () => {
      generation.value++
      offEvent?.()
      offState?.()
      window.clearInterval(timer)
    }
  }, [gateway, refresh, generation])

  const current = snapshot?.gateway === gateway && snapshot?.profile === profile ? snapshot : null

  return {
    questions: current?.questions ?? [],
    count: current?.open_count ?? 0,
    loading: Boolean(gateway && !current && !error),
    error,
    refresh
  }
}

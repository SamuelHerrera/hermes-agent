import { atom } from 'nanostores'

import type { CronJob } from '@/types/hermes'

function sameCronJobs(a: CronJob[], b: CronJob[]): boolean {
  if (a.length !== b.length) {
    return false
  }

  return a.every((job, i) => {
    const other = b[i]

    return (
      other != null &&
      job.id === other.id &&
      job.name === other.name &&
      job.enabled === other.enabled &&
      job.state === other.state &&
      job.last_error === other.last_error &&
      job.last_run_at === other.last_run_at &&
      job.next_run_at === other.next_run_at &&
      job.deliver === other.deliver &&
      job.model === other.model &&
      job.provider === other.provider &&
      job.prompt === other.prompt &&
      job.script === other.script &&
      job.schedule_display === other.schedule_display &&
      job.schedule?.display === other.schedule?.display &&
      job.schedule?.expr === other.schedule?.expr &&
      job.schedule?.kind === other.schedule?.kind
    )
  })
}

// Cron *jobs* (not run sessions) power the sidebar "Cron jobs" section. Listing
// the job — schedule, state, live next-run countdown — makes the job the
// first-class entity; its runs (sessions) resolve under it in the cron detail.
export const $cronJobs = atom<CronJob[]>([])
export const setCronJobs = (jobs: CronJob[]) => $cronJobs.set(sameCronJobs($cronJobs.get(), jobs) ? $cronJobs.get() : jobs)

// In-place edit so the cron overlay's mutations (create/edit/delete/pause/…)
// land in the same atom the sidebar renders — no stale list until the next poll.
export const updateCronJobs = (fn: (jobs: CronJob[]) => CronJob[]) => $cronJobs.set(fn($cronJobs.get()))

// One-shot focus target: clicking "Manage" on a job sets this, then opens the
// cron overlay, which reads it once to select + scroll to that job. Cleared
// after consumption so re-opening cron normally doesn't re-focus a stale job.
export const $cronFocusJobId = atom<null | string>(null)
export const setCronFocusJobId = (id: null | string) => $cronFocusJobId.set(id)

// Shell-owned one-shot intent for stores without router context. Do not set a
// focus id here: the cron overlay's first fetch may not have loaded that row.
export const $cronReviewRequest = atom(0)
export const requestCronReview = () => $cronReviewRequest.set($cronReviewRequest.get() + 1)

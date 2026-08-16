import {
  Button,
  Codicon,
  host,
  queryClient,
  Tip,
  useMutation,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

import { APPROVALS_KEY, $boardSlug, fetchPendingApprovals, respondKanbanApproval } from './api'
import type { KanbanApprovalRequest } from './types'
import { errText } from './ui'

type NativeNotify = (input: { body?: string; title: string }) => void

const choiceLabel: Record<string, string> = {
  always: 'Always for worker',
  deny: 'Discard',
  once: 'Approve once',
  session: 'Approve this action'
}

export function KanbanApprovalBridge({ nativeNotify }: { nativeNotify?: NativeNotify }) {
  const slug = useValue($boardSlug)
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const notified = useRef(new Set<string>())
  const { data } = useQuery({
    queryFn: fetchPendingApprovals,
    queryKey: [...APPROVALS_KEY, slug],
    refetchInterval: 2_000
  })
  const approvals = data?.approvals ?? []
  const approval = approvals[Math.min(index, Math.max(approvals.length - 1, 0))]

  useEffect(() => {
    if (!approvals.length) {
      setOpen(false)
      setIndex(0)
      return
    }
    setIndex(value => Math.min(value, approvals.length - 1))
    setOpen(true)
    for (const item of approvals) {
      if (notified.current.has(item.id)) {
        continue
      }
      notified.current.add(item.id)
      host.notify({
        kind: 'warning',
        message: item.command,
        title: 'Kanban approval needed'
      })
      nativeNotify?.({
        body: item.command,
        title: 'Kanban approval needed'
      })
    }
  }, [approvals, nativeNotify])

  const pendingCount = approvals.length

  return (
    <>
      {pendingCount > 0 && (
        <Tip label={`${pendingCount} Kanban approval${pendingCount === 1 ? '' : 's'} waiting`}>
          <button
            className="inline-flex h-full items-center gap-1 rounded-none px-1.5 text-[0.6875rem] text-amber-300 transition-colors hover:bg-(--chrome-action-hover) hover:text-amber-200"
            onClick={() => setOpen(true)}
            type="button"
          >
            <Codicon name="warning" size="0.7rem" />
            <span className="tabular-nums">{pendingCount}</span>
          </button>
        </Tip>
      )}
      {approval && (
        <KanbanApprovalDialog
          approval={approval}
          count={approvals.length}
          index={index}
          onIndex={setIndex}
          onOpenChange={setOpen}
          open={open}
        />
      )}
    </>
  )
}

function KanbanApprovalDialog({
  approval,
  count,
  index,
  onIndex,
  onOpenChange,
  open
}: {
  approval: KanbanApprovalRequest
  count: number
  index: number
  onIndex: (index: number) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const choices = useMemo(() => {
    const raw = approval.choices?.length ? approval.choices : ['once', 'session', 'deny']
    return raw.filter(choice => ['once', 'session', 'always', 'deny'].includes(choice))
  }, [approval.choices])
  const mutation = useMutation({
    mutationFn: (choice: string) => respondKanbanApproval(approval.id, choice),
    onError: err => host.notify({ kind: 'error', message: errText(err), title: 'Approval response failed' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: APPROVALS_KEY })
      if (count <= 1) {
        onOpenChange(false)
        onIndex(0)
      } else {
        onIndex(Math.min(index, count - 2))
      }
    }
  })

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kanban worker approval</DialogTitle>
          <DialogDescription>
            {count > 1 ? `${index + 1} of ${count} pending approvals` : 'A headless Kanban worker is paused for your decision.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 text-sm">
          <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-amber-100">
            {approval.description || 'Allow this computer_use action?'}
          </div>
          <div className="grid gap-1 rounded-lg border border-border bg-(--ui-surface-muted) p-3">
            <div className="text-xs uppercase tracking-wide text-(--ui-text-tertiary)">Command</div>
            <code className="break-words text-xs text-(--ui-text-secondary)">{approval.command}</code>
          </div>
          <div className="text-xs text-(--ui-text-tertiary)">
            Task {approval.task_id}{approval.profile ? ` · ${approval.profile}` : ''}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-1">
            <Button disabled={index <= 0 || mutation.isPending} onClick={() => onIndex(index - 1)} size="xs" variant="ghost">
              Previous
            </Button>
            <Button disabled={index >= count - 1 || mutation.isPending} onClick={() => onIndex(index + 1)} size="xs" variant="ghost">
              Next
            </Button>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {choices.map(choice => (
              <Button
                disabled={mutation.isPending}
                key={choice}
                onClick={() => mutation.mutate(choice)}
                size="sm"
                variant={choice === 'deny' ? 'destructive' : choice === 'once' ? 'default' : 'outline'}
              >
                {mutation.isPending ? <Codicon className="animate-spin" name="loading" size="0.75rem" /> : null}
                {choiceLabel[choice] ?? choice}
              </Button>
            ))}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

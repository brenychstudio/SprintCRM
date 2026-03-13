import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '../../../i18n/i18n'
import { isoAtMadridNineAMForDateInput, isoAtMadridNineAMInDays } from '../../../lib/dates'
import { defaultNextForStage, leadsQueryKeys, logActivity, updateLead } from '../../../features/leads/leadsApi'
import type { Lead, LeadStage, NextAction } from '../../../features/leads/types'

type Props = {
  selectedIds: string[]
  leadsById: Record<string, Lead>
  onClear: () => void
}

function milestoneForStage(stage: LeadStage): 'replied' | 'proposal_sent' | 'won' | 'lost' | null {
  if (stage === 'replied') return 'replied'
  if (stage === 'proposal') return 'proposal_sent'
  if (stage === 'won') return 'won'
  if (stage === 'lost') return 'lost'
  return null
}

const stageOptions: LeadStage[] = ['new', 'contacted', 'replied', 'proposal', 'won', 'lost']
const nextActionOptions: NextAction[] = ['follow_up', 'send_proposal', 'request_call', 'nurture']

async function runWithLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      if (!item) return
      await fn(item)
    }
  })
  await Promise.all(workers)
}

export function BulkActionsBar({ selectedIds, leadsById, onClear }: Props) {
  const { t } = useI18n()
  const qc = useQueryClient()

  const selectedLeads = useMemo(() => selectedIds.map((id) => leadsById[id]).filter(Boolean), [selectedIds, leadsById])
  const activeSelected = useMemo(() => selectedLeads.filter((lead) => lead.status === 'active'), [selectedLeads])
  const archivedSelected = useMemo(() => selectedLeads.filter((lead) => lead.status === 'archived'), [selectedLeads])

  const [stageTo, setStageTo] = useState<LeadStage>('contacted')
  const [nextAction, setNextAction] = useState<NextAction>('follow_up')
  const [nextDate, setNextDate] = useState<string>(() => new Date().toISOString().slice(0, 10))

  const bulkTouchMutation = useMutation({
    mutationFn: async () => {
      const nowIso = new Date().toISOString()

      await runWithLimit(activeSelected, 10, async (lead) => {
        await updateLead(lead.id, { last_touch_at: nowIso })
        await logActivity({ lead_id: lead.id, type: 'contacted', channel: 'email' })
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: leadsQueryKeys.all })
      onClear()
    },
  })

  const bulkStageMutation = useMutation({
    mutationFn: async () => {
      if ((stageTo === 'won' || stageTo === 'lost') && !window.confirm(t('leads.bulk.archiveConfirm', { count: activeSelected.length }))) {
        return
      }

      const nowIso = new Date().toISOString()

      await runWithLimit(activeSelected, 10, async (lead) => {
        if (lead.stage === stageTo) return

        const next = defaultNextForStage(stageTo)
        const nextActionAt = isoAtMadridNineAMInDays(next.days)

        await updateLead(lead.id, {
          stage: stageTo,
          next_action: next.next_action,
          next_action_at: nextActionAt,
          last_touch_at: nowIso,
        })

        await logActivity({
          lead_id: lead.id,
          type: 'stage_changed',
          meta: { from: lead.stage, to: stageTo, next_action: next.next_action, next_action_at: nextActionAt },
        })

        const milestone = milestoneForStage(stageTo)
        if (milestone) await logActivity({ lead_id: lead.id, type: milestone })
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: leadsQueryKeys.all })
      onClear()
    },
  })

  const bulkNextMutation = useMutation({
    mutationFn: async () => {
      const atIso = isoAtMadridNineAMForDateInput(nextDate)

      await runWithLimit(activeSelected, 10, async (lead) => {
        await updateLead(lead.id, { next_action: nextAction, next_action_at: atIso })

        await logActivity({
          lead_id: lead.id,
          type: 'next_action_set',
          meta: { stage: lead.stage, next_action: nextAction, next_action_at: atIso },
        })
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: leadsQueryKeys.all })
      onClear()
    },
  })

  const bulkArchiveMutation = useMutation({
    mutationFn: async () => {
      if (!window.confirm(t('leads.bulk.archiveConfirm', { count: activeSelected.length }))) return

      await runWithLimit(activeSelected, 10, async (lead) => {
        await updateLead(lead.id, { status: 'archived' })
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: leadsQueryKeys.all })
      onClear()
    },
  })

  const bulkRestoreMutation = useMutation({
    mutationFn: async () => {
      if (!window.confirm(t('leads.bulk.restoreConfirm', { count: archivedSelected.length }))) return

      await runWithLimit(archivedSelected, 10, async (lead) => {
        await updateLead(lead.id, { status: 'active' })
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: leadsQueryKeys.all })
      onClear()
    },
  })

  const busy =
    bulkTouchMutation.isPending ||
    bulkStageMutation.isPending ||
    bulkNextMutation.isPending ||
    bulkArchiveMutation.isPending ||
    bulkRestoreMutation.isPending

  return (
    <div className="mb-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1 text-sm text-zinc-700">
          <div>
            <span className="font-medium text-zinc-900">{t('leads.bulk.selected')}</span>:{' '}
            <span className="font-semibold text-zinc-900">{selectedIds.length}</span>
          </div>
          <div className="text-xs text-zinc-500">
            {t('leads.bulk.activeCount')}: {activeSelected.length} · {t('leads.smartViews.archived')}: {archivedSelected.length}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
            disabled={busy}
          >
            {t('leads.bulk.clear')}
          </button>

          <span className="h-5 w-px bg-zinc-200" aria-hidden="true" />

          <button
            type="button"
            onClick={() => bulkTouchMutation.mutate()}
            className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
            disabled={busy || activeSelected.length === 0}
          >
            {t('leads.bulk.logTouch')}
          </button>

          <span className="h-5 w-px bg-zinc-200" aria-hidden="true" />

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={stageTo}
              onChange={(e) => setStageTo(e.target.value as LeadStage)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-200"
              disabled={busy || activeSelected.length === 0}
            >
              {stageOptions.map((s) => (
                <option key={s} value={s}>
                  {t(`leads.filter.stage.${s}`)}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => bulkStageMutation.mutate()}
              className="rounded-xl bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-60"
              disabled={busy || activeSelected.length === 0}
            >
              {t('leads.bulk.applyStage')}
            </button>
          </div>

          <span className="h-5 w-px bg-zinc-200" aria-hidden="true" />

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value as NextAction)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-200"
              disabled={busy || activeSelected.length === 0}
            >
              {nextActionOptions.map((a) => (
                <option key={a} value={a}>
                  {t(`action.${a}`)}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-200"
              disabled={busy || activeSelected.length === 0}
            />

            <button
              type="button"
              onClick={() => bulkNextMutation.mutate()}
              className="rounded-xl bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-60"
              disabled={busy || activeSelected.length === 0}
            >
              {t('leads.bulk.applyNext')}
            </button>
          </div>

          <span className="h-5 w-px bg-zinc-200" aria-hidden="true" />

          <button
            type="button"
            onClick={() => bulkArchiveMutation.mutate()}
            className="rounded-xl border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
            disabled={busy || activeSelected.length === 0}
          >
            {t('leads.bulk.archive')}
          </button>

          <button
            type="button"
            onClick={() => bulkRestoreMutation.mutate()}
            className="rounded-xl border border-emerald-200 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
            disabled={busy || archivedSelected.length === 0}
          >
            {t('leads.bulk.restore')}
          </button>
        </div>
      </div>
    </div>
  )
}
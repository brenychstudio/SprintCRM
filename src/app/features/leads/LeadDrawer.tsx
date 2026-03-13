import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { defaultNextForStage, leadsQueryKeys, listActivities, logActivity, updateLead } from '../../../features/leads/leadsApi'
import type { Lead, LeadStage, NextAction } from '../../../features/leads/types'
import { useI18n } from '../../../i18n/i18n'
import { isoAtMadridNineAMForDateInput, isoAtMadridNineAMInDays } from '../../../lib/dates'

const stageValues: LeadStage[] = ['new', 'contacted', 'replied', 'proposal', 'won', 'lost']
const nextActionOptions: NextAction[] = ['follow_up', 'send_proposal', 'request_call', 'nurture']

function milestoneForStage(stage: LeadStage): 'replied' | 'proposal_sent' | 'won' | 'lost' | null {
  if (stage === 'replied') return 'replied'
  if (stage === 'proposal') return 'proposal_sent'
  if (stage === 'won') return 'won'
  if (stage === 'lost') return 'lost'
  return null
}

export function LeadDrawer({
  lead,
  onClose,
  onLeadChange,
}: {
  lead: Lead
  onClose: () => void
  onLeadChange?: (lead: Lead) => void
}) {
  const queryClient = useQueryClient()
  const { t } = useI18n()

  const [stage, setStage] = useState(lead.stage)
  const [nextAction, setNextAction] = useState(lead.next_action)
  const [nextDate, setNextDate] = useState(lead.next_action_at.slice(0, 10))
  const [notes, setNotes] = useState(lead.notes ?? '')

  const [baselineStage, setBaselineStage] = useState(lead.stage)
  const [baselineNextAction, setBaselineNextAction] = useState(lead.next_action)
  const [baselineNextDate, setBaselineNextDate] = useState(lead.next_action_at.slice(0, 10))
  const [baselineNotes, setBaselineNotes] = useState(lead.notes ?? '')

  useEffect(() => {
    setStage(lead.stage)
    setNextAction(lead.next_action)
    setNextDate(lead.next_action_at.slice(0, 10))
    setNotes(lead.notes ?? '')

    setBaselineStage(lead.stage)
    setBaselineNextAction(lead.next_action)
    setBaselineNextDate(lead.next_action_at.slice(0, 10))
    setBaselineNotes(lead.notes ?? '')
  }, [lead])

  const activitiesQuery = useQuery({
    queryKey: leadsQueryKeys.activities(lead.id),
    queryFn: () => listActivities(lead.id),
  })

  const recentActivities = useMemo(() => (activitiesQuery.data ?? []).slice(0, 8), [activitiesQuery.data])

  const handleChanged = (updatedLead: Lead) => {
    onLeadChange?.(updatedLead)
    queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
    queryClient.invalidateQueries({ queryKey: leadsQueryKeys.activities(lead.id) })
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const stageDirty = stage !== baselineStage
      const nextActionDirty = nextAction !== baselineNextAction
      const nextDateDirty = nextDate !== baselineNextDate
      const notesDirty = notes !== baselineNotes

      if (!stageDirty && !nextActionDirty && !nextDateDirty && !notesDirty) return lead

      const updatedLead = await updateLead(lead.id, {
        stage,
        next_action: nextAction,
        next_action_at: isoAtMadridNineAMForDateInput(nextDate),
        notes,
      })

      if (stageDirty) {
        await logActivity({
          lead_id: lead.id,
          type: 'stage_changed',
          meta: { from: baselineStage, to: stage, next_action: nextAction, next_action_at: updatedLead.next_action_at },
        })

        const milestone = milestoneForStage(stage)
        if (milestone) {
          await logActivity({ lead_id: lead.id, type: milestone })
        }
      }

      if (nextActionDirty || nextDateDirty) {
        await logActivity({
          lead_id: lead.id,
          type: 'next_action_set',
          meta: { stage, next_action: nextAction, next_action_at: updatedLead.next_action_at },
        })
      }

      return updatedLead
    },
    onSuccess: handleChanged,
  })

  const touchMutation = useMutation({
    mutationFn: async () => {
      const updatedLead = await updateLead(lead.id, { last_touch_at: new Date().toISOString() })
      await logActivity({ lead_id: lead.id, type: 'contacted', channel: 'email' })
      return updatedLead
    },
    onSuccess: handleChanged,
  })

  const moveMutation = useMutation({
    mutationFn: async (targetStage: LeadStage) => {
      const next = defaultNextForStage(targetStage)
      const nextActionAt = isoAtMadridNineAMInDays(next.days)

      const updatedLead = await updateLead(lead.id, {
        stage: targetStage,
        next_action: next.next_action,
        next_action_at: nextActionAt,
        last_touch_at: new Date().toISOString(),
      })

      if (lead.stage !== targetStage) {
        await logActivity({
          lead_id: lead.id,
          type: 'stage_changed',
          meta: { from: lead.stage, to: targetStage, next_action: next.next_action, next_action_at: nextActionAt },
        })

        const milestone = milestoneForStage(targetStage)
        if (milestone) {
          await logActivity({ lead_id: lead.id, type: milestone })
        }
      }

      return updatedLead
    },
    onSuccess: handleChanged,
  })

  const isBusy = saveMutation.isPending || touchMutation.isPending || moveMutation.isPending

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-900/30">
      <button type="button" aria-label={t('drawer.close')} onClick={onClose} className="h-full flex-1" />

      <aside className="h-full w-full max-w-lg overflow-y-auto border-l border-zinc-200 bg-white shadow-xl">
        <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-zinc-900">{lead.company_name}</h2>
              <p className="mt-1 text-xs text-zinc-500">{t('drawer.leadId', { id: lead.id })}</p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
            >
              {t('drawer.close')}
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-xs text-zinc-500">{t('drawer.stage')}</div>
              <div className="mt-2 text-sm font-medium text-zinc-900">{t(`leads.filter.stage.${lead.stage}`)}</div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-xs text-zinc-500">{t('drawer.nextAction')}</div>
              <div className="mt-2 text-sm font-medium text-zinc-900">{t(`action.${lead.next_action}`)}</div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-xs text-zinc-500">{t('drawer.nextDate')}</div>
              <div className="mt-2 text-sm font-medium text-zinc-900">{new Date(lead.next_action_at).toLocaleString()}</div>
            </div>
          </div>

          <div className="mt-5 grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs text-zinc-500">{t('drawer.stage')}</span>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value as LeadStage)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                >
                  {stageValues.map((s) => (
                    <option key={s} value={s}>
                      {t(`leads.filter.stage.${s}`)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs text-zinc-500">{t('drawer.nextAction')}</span>
                <select
                  value={nextAction}
                  onChange={(e) => setNextAction(e.target.value as NextAction)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                >
                  {nextActionOptions.map((a) => (
                    <option key={a} value={a}>
                      {t(`action.${a}`)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs text-zinc-500">{t('drawer.nextDate')}</span>
                <input
                  type="date"
                  value={nextDate}
                  onChange={(e) => setNextDate(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <label className="space-y-1">
              <span className="text-xs text-zinc-500">{t('drawer.notes')}</span>
              <textarea
                rows={5}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-2xl border border-zinc-200 px-3 py-3 text-sm"
              />
            </label>
          </div>

          <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="text-xs text-zinc-500">{t('drawer.activityTitle')}</div>

            {activitiesQuery.isLoading ? <p className="mt-3 text-sm text-zinc-500">{t('drawer.loadingActivities')}</p> : null}

            {!activitiesQuery.isLoading && !recentActivities.length ? (
              <p className="mt-3 text-sm text-zinc-500">{t('drawer.noActivities')}</p>
            ) : null}

            <ul className="mt-3 space-y-2">
              {recentActivities.map((activity) => (
                <li key={activity.id} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm">
                  <p className="font-medium text-zinc-800">{t(`activity.${activity.type}`)}</p>
                  <p className="text-xs text-zinc-500">{new Date(activity.at).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-zinc-200 bg-white px-6 py-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => touchMutation.mutate()}
              disabled={isBusy}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"
            >
              {t('drawer.logTouch')}
            </button>

            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={isBusy}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white"
            >
              {t('drawer.save')}
            </button>

            {(['contacted', 'replied', 'proposal'] as LeadStage[]).map((targetStage) => (
              <button
                key={targetStage}
                type="button"
                onClick={() => moveMutation.mutate(targetStage)}
                disabled={isBusy}
                className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"
              >
                {t(`leads.filter.stage.${targetStage}`)}
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  )
}
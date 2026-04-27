import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  defaultNextForStage,
  deleteLeadPermanently,
  leadsQueryKeys,
  listActivities,
  logActivity,
  updateLead,
} from '../../../features/leads/leadsApi'
import type { Lead, LeadStage, NextAction } from '../../../features/leads/types'
import { useI18n } from '../../../i18n/i18n'
import { isoAtMadridNineAMForDateInput, isoAtMadridNineAMInDays } from '../../../lib/dates'

const stageValues: LeadStage[] = ['new', 'contacted', 'replied', 'proposal', 'won', 'lost']
const nextActionOptions: NextAction[] = ['follow_up', 'send_proposal', 'request_call', 'nurture']
const resultStageValues: LeadStage[] = ['contacted', 'replied', 'proposal']

function milestoneForStage(stage: LeadStage): 'replied' | 'proposal_sent' | 'won' | 'lost' | null {
  if (stage === 'replied') return 'replied'
  if (stage === 'proposal') return 'proposal_sent'
  if (stage === 'won') return 'won'
  if (stage === 'lost') return 'lost'
  return null
}

function formatDrawerDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function isLeadOverdue(iso: string): boolean {
  return new Date(iso).getTime() < Date.now()
}

function pickPrimaryContact(lead: Lead): string {
  return [lead.contact_name, lead.email, lead.phone].filter(Boolean).join(' · ') || lead.website_domain || lead.website || '—'
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

  const recentActivities = useMemo(() => (activitiesQuery.data ?? []).slice(0, 5), [activitiesQuery.data])
  const overdue = isLeadOverdue(lead.next_action_at)

  const contextRows = [
    { label: t('drawer.context.niche'), value: lead.niche },
    { label: t('drawer.context.location'), value: lead.country_city },
    { label: t('drawer.context.website'), value: lead.website_domain || lead.website },
    { label: t('drawer.context.source'), value: lead.source_file },
  ].filter((row) => row.value)

  const handleChanged = (updatedLead: Lead) => {
    onLeadChange?.(updatedLead)
    queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
    queryClient.invalidateQueries({ queryKey: leadsQueryKeys.activities(lead.id) })
  }

  const handleDeleted = () => {
    queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
    queryClient.invalidateQueries({ queryKey: leadsQueryKeys.activities(lead.id) })
    onClose()
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

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const nextStatus = lead.status === 'archived' ? 'active' : 'archived'
      return updateLead(lead.id, { status: nextStatus })
    },
    onSuccess: handleChanged,
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await deleteLeadPermanently(lead.id)
    },
    onSuccess: handleDeleted,
  })

  function handlePermanentDelete() {
    if (lead.status !== 'archived') return
    const ok = window.confirm(t('drawer.deleteConfirm'))
    if (!ok) return
    deleteMutation.mutate()
  }

  const isBusy =
    saveMutation.isPending ||
    touchMutation.isPending ||
    moveMutation.isPending ||
    archiveMutation.isPending ||
    deleteMutation.isPending

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-900/35 backdrop-blur-[1px]">
      <button type="button" aria-label={t('drawer.close')} onClick={onClose} className="h-full flex-1" />

      <aside className="h-full w-full max-w-xl overflow-y-auto overflow-x-hidden border-l border-zinc-200 bg-white shadow-xl">
        <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 px-6 py-5 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-xl font-semibold text-zinc-900">{lead.company_name}</h2>
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">
                  {t(`leads.filter.stage.${lead.stage}`)}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    lead.status === 'archived' ? 'bg-zinc-100 text-zinc-500' : 'bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {lead.status === 'archived' ? t('drawer.statusArchived') : t('drawer.statusActive')}
                </span>
              </div>

              <p className="mt-1 truncate text-sm text-zinc-500">{pickPrimaryContact(lead)}</p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
            >
              {t('drawer.close')}
            </button>
          </div>
        </div>

        <div className="space-y-5 px-6 py-5">
          <section className="rounded-3xl border border-zinc-200 bg-zinc-950 p-5 text-white shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">{t('drawer.nextStepTitle')}</div>
                <div className="mt-2 text-2xl font-semibold leading-tight">{t(`action.${lead.next_action}`)}</div>
                <div className="mt-2 text-sm text-zinc-300">{t('drawer.nextStepSubtitle')}</div>
              </div>

              <div className="rounded-2xl bg-white/10 px-4 py-3 text-left sm:text-right">
                <div className="text-xs text-zinc-400">{t('drawer.nextDate')}</div>
                <div className="mt-1 text-sm font-semibold text-white">{formatDrawerDate(lead.next_action_at)}</div>
                <div className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs ${overdue ? 'bg-red-400/15 text-red-200' : 'bg-white/10 text-zinc-200'}`}>
                  {overdue ? t('drawer.dueOverdue') : t('drawer.dueReady')}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => touchMutation.mutate()}
                disabled={isBusy}
                className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-100 disabled:opacity-50"
              >
                {t('drawer.logTouch')}
              </button>

              <button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={isBusy}
                className="rounded-xl border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
              >
                {t('drawer.save')}
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-5">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">{t('drawer.resultTitle')}</h3>
              <p className="mt-1 text-sm text-zinc-500">{t('drawer.resultSubtitle')}</p>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {resultStageValues.map((targetStage) => (
                <button
                  key={targetStage}
                  type="button"
                  onClick={() => moveMutation.mutate(targetStage)}
                  disabled={isBusy || lead.stage === targetStage}
                  className="rounded-2xl border border-zinc-200 px-3 py-3 text-left text-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span className="block font-medium text-zinc-900">{t(`drawer.result.${targetStage}`)}</span>
                  <span className="mt-1 block text-xs text-zinc-500">{t(`drawer.resultHint.${targetStage}`)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-zinc-50 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">{t('drawer.editTitle')}</h3>
                <p className="mt-1 text-sm text-zinc-500">{t('drawer.editSubtitle')}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="min-w-0 space-y-1">
                <span className="text-xs text-zinc-500">{t('drawer.stage')}</span>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value as LeadStage)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                >
                  {stageValues.map((s) => (
                    <option key={s} value={s}>
                      {t(`leads.filter.stage.${s}`)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="min-w-0 space-y-1">
                <span className="text-xs text-zinc-500">{t('drawer.nextAction')}</span>
                <select
                  value={nextAction}
                  onChange={(e) => setNextAction(e.target.value as NextAction)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                >
                  {nextActionOptions.map((a) => (
                    <option key={a} value={a}>
                      {t(`action.${a}`)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="min-w-0 space-y-1">
                <span className="text-xs text-zinc-500">{t('drawer.nextDate')}</span>
                <input
                  type="date"
                  value={nextDate}
                  onChange={(e) => setNextDate(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                />
              </label>
            </div>

            <label className="mt-4 block space-y-1">
              <span className="text-xs text-zinc-500">{t('drawer.notes')}</span>
              <textarea
                rows={5}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-sm leading-relaxed"
              />
            </label>
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-zinc-900">{t('drawer.contextTitle')}</h3>

            {contextRows.length ? (
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                {contextRows.map((row) => (
                  <div key={row.label} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                    <dt className="text-xs text-zinc-500">{row.label}</dt>
                    <dd className="mt-1 break-words text-sm font-medium text-zinc-800">{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">{t('drawer.noContext')}</p>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-zinc-900">{t('drawer.activityTitle')}</h3>
              {!!activitiesQuery.data?.length ? (
                <span className="text-xs text-zinc-500">
                  {recentActivities.length} / {activitiesQuery.data?.length}
                </span>
              ) : null}
            </div>

            {activitiesQuery.isLoading ? <p className="mt-3 text-sm text-zinc-500">{t('drawer.loadingActivities')}</p> : null}

            {!activitiesQuery.isLoading && !recentActivities.length ? (
              <p className="mt-3 text-sm text-zinc-500">{t('drawer.noActivities')}</p>
            ) : null}

            {!!recentActivities.length ? (
              <div className="mt-3 max-h-64 overflow-y-auto pr-1">
                <ul className="space-y-2">
                  {recentActivities.map((activity) => (
                    <li key={activity.id} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                      <p className="text-sm font-medium leading-tight text-zinc-800">{t(`activity.${activity.type}`)}</p>
                      <p className="mt-1 text-xs text-zinc-500">{formatDrawerDate(activity.at)}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <details className="rounded-3xl border border-zinc-200 bg-white p-5">
            <summary className="cursor-pointer text-sm font-semibold text-zinc-900">{t('drawer.dangerTitle')}</summary>
            <p className="mt-3 text-sm text-zinc-500">
              {lead.status === 'archived' ? t('drawer.deleteHintArchived') : t('drawer.deleteHintArchiveFirst')}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => archiveMutation.mutate()}
                disabled={isBusy}
                className={`rounded-xl px-3 py-2 text-sm transition disabled:opacity-60 ${
                  lead.status === 'archived'
                    ? 'border border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                    : 'border border-zinc-200 text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                {lead.status === 'archived' ? t('drawer.restore') : t('drawer.archive')}
              </button>

              {lead.status === 'archived' ? (
                <button
                  type="button"
                  onClick={handlePermanentDelete}
                  disabled={isBusy}
                  className="rounded-xl border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {t('drawer.deletePermanent')}
                </button>
              ) : null}
            </div>
          </details>
        </div>
      </aside>
    </div>
  )
}

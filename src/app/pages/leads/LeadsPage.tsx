import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createLead,
  defaultNextForStage,
  leadsQueryKeys,
  listActivities,
  listLeads,
  logActivity,
  updateLead,
} from '../../../features/leads/leadsApi'
import type { Lead, LeadDueFilter, LeadStage, NextAction } from '../../../features/leads/types'
import { useI18n } from '../../../i18n/i18n'
import { isoAtMadridNineAMForDateInput, isoAtMadridNineAMInDays } from '../../../lib/dates'

const stageValues: Array<LeadStage | 'all'> = ['all', 'new', 'contacted', 'replied', 'proposal', 'won', 'lost']
const dueValues: Array<LeadDueFilter | 'all'> = ['all', 'today', 'overdue']
const nextActionOptions: NextAction[] = ['follow_up', 'send_proposal', 'request_call', 'nurture']

function actionLabel(action: NextAction, t: (key: string) => string) {
  return t(`action.${action}`)
}

function LeadDrawer({ lead, onClose, onLeadChange }: { lead: Lead; onClose: () => void; onLeadChange: (lead: Lead) => void }) {
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const [stage, setStage] = useState(lead.stage)
  const [nextAction, setNextAction] = useState(lead.next_action)
  const [nextDate, setNextDate] = useState(lead.next_action_at.slice(0, 10))
  const [notes, setNotes] = useState(lead.notes ?? '')

  useEffect(() => {
    setStage(lead.stage)
    setNextAction(lead.next_action)
    setNextDate(lead.next_action_at.slice(0, 10))
    setNotes(lead.notes ?? '')
  }, [lead])

  const activitiesQuery = useQuery({
    queryKey: leadsQueryKeys.activities(lead.id),
    queryFn: () => listActivities(lead.id),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updatedLead = await updateLead(lead.id, {
        stage,
        next_action: nextAction,
        next_action_at: isoAtMadridNineAMForDateInput(nextDate),
        notes,
      })

      await logActivity({
        lead_id: lead.id,
        type: 'next_action_set',
        meta: { stage, next_action: nextAction, next_action_at: updatedLead.next_action_at },
      })

      return updatedLead
    },
    onSuccess: (updatedLead) => {
      onLeadChange(updatedLead)
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.activities(lead.id) })
    },
  })

  const touchMutation = useMutation({
    mutationFn: async () => {
      const updatedLead = await updateLead(lead.id, { last_touch_at: new Date().toISOString() })
      await logActivity({ lead_id: lead.id, type: 'contacted', channel: 'email' })
      return updatedLead
    },
    onSuccess: (updatedLead) => {
      onLeadChange(updatedLead)
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.activities(lead.id) })
    },
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

      await logActivity({
        lead_id: lead.id,
        type: 'stage_changed',
        meta: { from: lead.stage, to: targetStage, next_action: next.next_action, next_action_at: nextActionAt },
      })

      return updatedLead
    },
    onSuccess: (updatedLead) => {
      onLeadChange(updatedLead)
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.activities(lead.id) })
    },
  })

  const isBusy = saveMutation.isPending || touchMutation.isPending || moveMutation.isPending

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-900/30">
      <button type="button" aria-label={t('drawer.close')} onClick={onClose} className="h-full flex-1" />
      <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-zinc-200 bg-white p-6 shadow-xl">
        <h2 className="text-xl font-semibold text-zinc-900">{lead.company_name}</h2>
        <p className="mt-1 text-xs text-zinc-500">{t('drawer.leadId', { id: lead.id })}</p>

        <div className="mt-6 grid gap-4">
          <label className="space-y-1"><span className="text-xs text-zinc-500">{t('drawer.stage')}</span>
            <select value={stage} onChange={(e) => setStage(e.target.value as LeadStage)} className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm">
              {stageValues.filter((s) => s !== 'all').map((s) => <option key={s} value={s}>{t(`leads.filter.stage.${s}`)}</option>)}
            </select>
          </label>
          <label className="space-y-1"><span className="text-xs text-zinc-500">{t('drawer.nextAction')}</span>
            <select value={nextAction} onChange={(e) => setNextAction(e.target.value as NextAction)} className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm">
              {nextActionOptions.map((a) => <option key={a} value={a}>{actionLabel(a, t)}</option>)}
            </select>
          </label>
          <label className="space-y-1"><span className="text-xs text-zinc-500">{t('drawer.nextDate')}</span>
            <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm" />
          </label>
          <label className="space-y-1"><span className="text-xs text-zinc-500">{t('drawer.notes')}</span>
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => touchMutation.mutate()} disabled={isBusy} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm">{t('drawer.logTouch')}</button>
          <button type="button" onClick={() => saveMutation.mutate()} disabled={isBusy} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white">{t('drawer.save')}</button>
          {(['contacted', 'replied', 'proposal'] as LeadStage[]).map((targetStage) => (
            <button key={targetStage} type="button" onClick={() => moveMutation.mutate(targetStage)} disabled={isBusy} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm capitalize">{t(`leads.filter.stage.${targetStage}`)}</button>
          ))}
        </div>

        <div className="mt-8">
          <h3 className="text-sm font-semibold text-zinc-900">{t('drawer.activityTitle')}</h3>
          {activitiesQuery.isLoading ? <p className="mt-3 text-sm text-zinc-500">{t('drawer.loadingActivities')}</p> : null}
          {!activitiesQuery.isLoading && !activitiesQuery.data?.length ? <p className="mt-3 text-sm text-zinc-500">{t('drawer.noActivities')}</p> : null}
          <ul className="mt-3 space-y-2">
            {activitiesQuery.data?.map((activity) => (
              <li key={activity.id} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm">
                <p className="font-medium text-zinc-800">{t(`activity.${activity.type}`)}</p>
                <p className="text-xs text-zinc-500">{new Date(activity.at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}

export function LeadsPage() {
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [stage, setStage] = useState<LeadStage | 'all'>('all')
  const [due, setDue] = useState<LeadDueFilter | 'all'>('all')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  const filters = useMemo(
    () => ({
      q: search.trim() || undefined,
      stage: stage === 'all' ? undefined : stage,
      due: due === 'all' ? undefined : due,
    }),
    [due, search, stage],
  )

  const leadsQuery = useQuery({
    queryKey: leadsQueryKeys.list(filters),
    queryFn: () => listLeads(filters),
  })

  const createMutation = useMutation({
    mutationFn: () => createLead({ company_name: 'New company' }),
    onSuccess: (createdLead) => {
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
      setSelectedLead(createdLead)
    },
  })

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">{t('leads.title')}</h1>
          <p className="mt-1 text-sm text-zinc-600">{t('leads.subtitle')}</p>
        </div>
        <button type="button" onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white">{createMutation.isPending ? t('leads.creating') : t('leads.newLead')}</button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('leads.searchPlaceholder')} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm" />
        <select value={stage} onChange={(event) => setStage(event.target.value as LeadStage | 'all')} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm">
          {stageValues.map((option) => <option key={option} value={option}>{t(`leads.filter.stage.${option}`)}</option>)}
        </select>
        <select value={due} onChange={(event) => setDue(event.target.value as LeadDueFilter | 'all')} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm">
          {dueValues.map((option) => <option key={option} value={option}>{t(`leads.filter.due.${option}`)}</option>)}
        </select>
      </div>

      {leadsQuery.isLoading ? (
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">{t('leads.loading')}</div>
      ) : null}
      {leadsQuery.isError ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{t('leads.error')}</div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-200">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="px-4 py-3 font-medium">{t('leads.table.company')}</th><th className="px-4 py-3 font-medium">{t('leads.table.email')}</th><th className="px-4 py-3 font-medium">{t('leads.table.website')}</th><th className="px-4 py-3 font-medium">{t('leads.table.stage')}</th><th className="px-4 py-3 font-medium">{t('leads.table.nextActionAt')}</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 bg-white text-zinc-700">
            {leadsQuery.data?.map((lead) => (
              <tr key={lead.id} onClick={() => setSelectedLead(lead)} className="cursor-pointer transition hover:bg-zinc-50">
                <td className="px-4 py-3 text-zinc-900">{lead.company_name}</td>
                <td className="px-4 py-3">{lead.email ?? '—'}</td>
                <td className="px-4 py-3">{lead.website_domain ?? lead.website ?? '—'}</td>
                <td className="px-4 py-3">{t(`leads.filter.stage.${lead.stage}`)}</td>
                <td className="px-4 py-3">{new Date(lead.next_action_at).toLocaleString()}</td>
              </tr>
            ))}
            {!leadsQuery.data?.length ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm text-zinc-500" colSpan={5}>{t('leads.empty')}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedLead ? <LeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} onLeadChange={setSelectedLead} /> : null}
    </section>
  )
}

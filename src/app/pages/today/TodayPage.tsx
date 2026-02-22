import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { defaultNextForStage, leadsQueryKeys, listLeads, logActivity, updateLead } from '../../../features/leads/leadsApi'
import type { Lead, NextAction } from '../../../features/leads/types'
import { useI18n } from '../../../i18n/i18n'
import { endOfTodayISO, isoAtMadridNineAMInDays, startOfTodayISO } from '../../../lib/dates'

function TodayLeadDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { t } = useI18n()

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-900/30">
      <button type="button" aria-label={t('today.drawer.close')} onClick={onClose} className="h-full flex-1" />
      <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-zinc-200 bg-white p-6 shadow-xl">
        <h2 className="text-xl font-semibold text-zinc-900">{lead.company_name}</h2>
        <p className="mt-1 text-xs text-zinc-500">{lead.email ?? '—'}</p>

        <dl className="mt-6 grid grid-cols-1 gap-4 text-sm text-zinc-700">
          <div>
            <dt className="text-xs text-zinc-500">{t('today.drawer.stage')}</dt>
            <dd className="mt-1">{t(`leads.filter.stage.${lead.stage}`)}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">{t('today.drawer.nextAction')}</dt>
            <dd className="mt-1">{t(`action.${lead.next_action}`)}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">{t('today.drawer.nextAt')}</dt>
            <dd className="mt-1">{new Date(lead.next_action_at).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">{t('today.drawer.notes')}</dt>
            <dd className="mt-1 whitespace-pre-wrap">{lead.notes || '—'}</dd>
          </div>
        </dl>
      </aside>
    </div>
  )
}

export function TodayPage() {
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const startOfToday = useMemo(() => startOfTodayISO(), [])
  const endOfToday = useMemo(() => endOfTodayISO(), [])

  const queueQuery = useQuery({
    queryKey: leadsQueryKeys.list({ due: 'today' }),
    queryFn: () => listLeads(),
    select: (leads) => leads.filter((lead) => lead.next_action_at <= endOfToday),
  })

  const doneMutation = useMutation({
    mutationFn: async (lead: Lead) => {
      const next = defaultNextForStage(lead.stage)
      const nextActionAt = isoAtMadridNineAMInDays(next.days)

      const updatedLead = await updateLead(lead.id, {
        last_touch_at: new Date().toISOString(),
        next_action: next.next_action,
        next_action_at: nextActionAt,
      })

      await logActivity({
        lead_id: lead.id,
        type: 'next_action_set',
        meta: { auto: true, next_action: next.next_action, next_action_at: nextActionAt },
      })

      return updatedLead
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
    },
  })

  return (
    <section>
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">{t('today.title')}</h1>
        <p className="mt-2 text-sm text-zinc-600">{t('today.subtitle')}</p>
      </div>

      {queueQuery.isLoading ? (
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">{t('today.loading')}</div>
      ) : null}
      {queueQuery.isError ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{t('today.error')}</div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-200">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">{t('today.table.company')}</th>
              <th className="px-4 py-3 font-medium">{t('today.table.stage')}</th>
              <th className="px-4 py-3 font-medium">{t('today.table.nextAction')}</th>
              <th className="px-4 py-3 font-medium">{t('today.table.nextAt')}</th>
              <th className="px-4 py-3 font-medium">{t('today.table.status')}</th>
              <th className="px-4 py-3 font-medium text-right">{t('today.table.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 bg-white text-zinc-700">
            {queueQuery.data?.map((lead) => {
              const isOverdue = lead.next_action_at < startOfToday
              return (
                <tr key={lead.id}>
                  <td className="px-4 py-3 text-zinc-900">{lead.company_name}</td>
                  <td className="px-4 py-3">{t(`leads.filter.stage.${lead.stage}`)}</td>
                  <td className="px-4 py-3">{t(`action.${lead.next_action as NextAction}`)}</td>
                  <td className="px-4 py-3">{new Date(lead.next_action_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs ${isOverdue ? 'bg-red-50 text-red-700' : 'bg-zinc-100 text-zinc-700'}`}>
                      {isOverdue ? t('today.status.overdue') : t('today.status.today')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedLead(lead)}
                        className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
                      >
                        {t('today.actions.open')}
                      </button>
                      <button
                        type="button"
                        onClick={() => doneMutation.mutate(lead)}
                        disabled={doneMutation.isPending}
                        className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-60"
                      >
                        {t('today.actions.done')}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {!queueQuery.isLoading && !queueQuery.data?.length ? (
              <tr>
                <td className="px-4 py-8 text-center text-sm text-zinc-500" colSpan={6}>{t('today.empty')}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedLead ? <TodayLeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} /> : null}
    </section>
  )
}

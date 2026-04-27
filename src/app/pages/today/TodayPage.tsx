import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { leadsQueryKeys, listLeads } from '../../../features/leads/leadsApi'
import type { Lead } from '../../../features/leads/types'
import { LeadDrawer } from '../../features/leads/LeadDrawer'
import { useI18n } from '../../../i18n/i18n'
import { endOfTodayISO, startOfTodayISO } from '../../../lib/dates'

const PRIORITY_QUEUE_LIMIT = 12
const WARM_STAGES = new Set(['contacted', 'replied', 'proposal'])

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function buildLeadContext(lead: Lead): string {
  return [lead.niche, lead.country_city].filter(Boolean).join(' · ') || '—'
}

export function TodayPage() {
  const { t } = useI18n()
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  const startOfToday = useMemo(() => startOfTodayISO(), [])
  const endOfToday = useMemo(() => endOfTodayISO(), [])

  const queueQuery = useQuery({
    queryKey: leadsQueryKeys.list({ scope: 'today-queue' }),
    queryFn: () => listLeads(),
    select: (leads) =>
      leads
        .filter(
          (lead) =>
            lead.status === 'active' &&
            lead.stage !== 'won' &&
            lead.stage !== 'lost' &&
            lead.next_action_at <= endOfToday,
        )
        .sort((a, b) => a.next_action_at.localeCompare(b.next_action_at)),
  })

  const queue = queueQuery.data ?? []
  const visibleQueue = queue.slice(0, PRIORITY_QUEUE_LIMIT)
  const nextLead = visibleQueue[0] ?? null

  const overdueCount = queue.filter((lead) => lead.next_action_at < startOfToday).length
  const todayCount = queue.filter((lead) => lead.next_action_at >= startOfToday && lead.next_action_at <= endOfToday).length
  const warmCount = queue.filter((lead) => WARM_STAGES.has(lead.stage)).length

  return (
    <section>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">{t('today.title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600">{t('today.subtitle')}</p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (nextLead) setSelectedLead(nextLead)
          }}
          disabled={!nextLead}
          className="rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('today.queue.openNext')}
        </button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('today.kpi.total')}</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-900">{queue.length}</div>
        </div>

        <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
          <div className="text-xs text-red-600">{t('today.kpi.overdue')}</div>
          <div className="mt-2 text-2xl font-semibold text-red-700">{overdueCount}</div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('today.kpi.today')}</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-900">{todayCount}</div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('today.kpi.warm')}</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-900">{warmCount}</div>
        </div>
      </div>

      {queueQuery.isLoading ? (
        <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
          {t('today.loading')}
        </div>
      ) : null}

      {queueQuery.isError ? (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {t('today.error')}
        </div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <div className="flex flex-col gap-1 border-b border-zinc-200 bg-zinc-50 px-4 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">{t('today.queue.title')}</h2>
            <p className="mt-1 text-sm text-zinc-500">{t('today.queue.subtitle')}</p>
          </div>

          {queue.length ? (
            <div className="text-xs text-zinc-500">
              {t('today.queue.showing', {
                shown: visibleQueue.length,
                total: queue.length,
              })}
            </div>
          ) : null}
        </div>

        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-white text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">{t('today.table.company')}</th>
              <th className="px-4 py-3 font-medium">{t('today.table.context')}</th>
              <th className="px-4 py-3 font-medium">{t('today.table.nextAction')}</th>
              <th className="px-4 py-3 font-medium">{t('today.table.nextAt')}</th>
              <th className="px-4 py-3 font-medium text-right">{t('today.table.actions')}</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-200 bg-white text-zinc-700">
            {visibleQueue.map((lead) => {
              const isOverdue = lead.next_action_at < startOfToday

              return (
                <tr key={lead.id} className="transition hover:bg-zinc-50">
                  <td className="px-4 py-4 align-top">
                    <button
                      type="button"
                      onClick={() => setSelectedLead(lead)}
                      className="text-left font-semibold text-zinc-900 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20 focus-visible:ring-offset-2"
                    >
                      {lead.company_name}
                    </button>

                    <div className="mt-1 text-xs text-zinc-500">
                      {lead.email || lead.website_domain || lead.website || '—'}
                    </div>
                  </td>

                  <td className="px-4 py-4 align-top">
                    <div className="text-sm text-zinc-700">{buildLeadContext(lead)}</div>
                    <div className="mt-1 inline-flex rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600">
                      {t(`leads.filter.stage.${lead.stage}`)}
                    </div>
                  </td>

                  <td className="px-4 py-4 align-top">
                    <div className="font-medium text-zinc-900">{t(`action.${lead.next_action}`)}</div>
                  </td>

                  <td className="px-4 py-4 align-top">
                    <div className={isOverdue ? 'font-medium text-red-700' : 'font-medium text-zinc-900'}>
                      {formatDateTime(lead.next_action_at)}
                    </div>

                    <div
                      className={`mt-1 inline-flex rounded-full px-2 py-1 text-xs ${
                        isOverdue ? 'bg-red-50 text-red-700' : 'bg-zinc-100 text-zinc-600'
                      }`}
                    >
                      {isOverdue ? t('today.status.overdue') : t('today.status.today')}
                    </div>
                  </td>

                  <td className="px-4 py-4 align-top">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setSelectedLead(lead)}
                        aria-label={t('today.actions.openLead', { company: lead.company_name })}
                        className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20 focus-visible:ring-offset-2"
                      >
                        {t('today.actions.open')}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}

            {!queueQuery.isLoading && !visibleQueue.length ? (
              <tr>
                <td className="px-4 py-10 text-center text-sm text-zinc-500" colSpan={5}>
                  {t('today.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedLead ? (
        <LeadDrawer
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onLeadChange={(updatedLead) => setSelectedLead(updatedLead)}
        />
      ) : null}
    </section>
  )
}

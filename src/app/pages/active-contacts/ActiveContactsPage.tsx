import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LeadDrawer } from '../../features/leads/LeadDrawer'
import { leadsQueryKeys, listLeads } from '../../../features/leads/leadsApi'
import type { Lead, LeadDueFilter } from '../../../features/leads/types'
import { useI18n } from '../../../i18n/i18n'

const activeStages = new Set(['contacted', 'replied', 'proposal'] as const)
const dueValues: Array<LeadDueFilter | 'all'> = ['all', 'today', 'overdue']

export function ActiveContactsPage() {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [due, setDue] = useState<LeadDueFilter | 'all'>('all')
  const [niche, setNiche] = useState('__all')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now())

  useEffect(() => {
    const interval = window.setInterval(() => setNowTimestamp(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const filters = useMemo(
    () => ({
      q: search.trim() || undefined,
      due: due === 'all' ? undefined : due,
    }),
    [due, search],
  )

  const leadsQuery = useQuery({
    queryKey: leadsQueryKeys.list({ ...filters, scope: 'activeContacts' }),
    queryFn: () => listLeads(filters),
  })

  const activeContacts = useMemo(() => {
    return (leadsQuery.data ?? []).filter((lead) => {
      if (lead.status !== 'active') return false
      if (!activeStages.has(lead.stage as 'contacted' | 'replied' | 'proposal')) return false

      const leadNiche = lead.niche?.trim() ?? ''
      if (niche === '__all') return true
      if (niche === '__unspecified') return !leadNiche
      return leadNiche === niche
    })
  }, [leadsQuery.data, niche])

  const nicheOptions = useMemo(() => {
    const values = new Set<string>()
    for (const lead of leadsQuery.data ?? []) {
      if (lead.status !== 'active') continue
      if (!activeStages.has(lead.stage as 'contacted' | 'replied' | 'proposal')) continue
      const value = lead.niche?.trim()
      if (value) values.add(value)
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }, [leadsQuery.data])

  const summary = useMemo(() => {
    let contacted = 0
    let replied = 0
    let proposal = 0
    let overdue = 0

    for (const lead of activeContacts) {
      if (lead.stage === 'contacted') contacted++
      if (lead.stage === 'replied') replied++
      if (lead.stage === 'proposal') proposal++
      if (new Date(lead.next_action_at).getTime() < nowTimestamp) overdue++
    }

    return { contacted, replied, proposal, overdue, total: activeContacts.length }
  }, [activeContacts, nowTimestamp])

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">{t('activeContacts.title')}</h1>
          <p className="mt-1 text-sm text-zinc-600">{t('activeContacts.subtitle')}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('activeContacts.kpi.total')}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{summary.total}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('activeContacts.kpi.contacted')}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{summary.contacted}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('activeContacts.kpi.replied')}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{summary.replied}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('activeContacts.kpi.proposal')}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{summary.proposal}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('activeContacts.kpi.overdue')}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{summary.overdue}</div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('activeContacts.searchPlaceholder')}
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"
        />

        <select
          value={niche}
          onChange={(event) => setNiche(event.target.value)}
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"
        >
          <option value="__all">{t('activeContacts.filter.nicheAll')}</option>
          <option value="__unspecified">{t('activeContacts.filter.nicheUnspecified')}</option>
          {nicheOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <select
          value={due}
          onChange={(event) => setDue(event.target.value as LeadDueFilter | 'all')}
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"
        >
          {dueValues.map((option) => (
            <option key={option} value={option}>
              {t(`leads.filter.due.${option}`)}
            </option>
          ))}
        </select>
      </div>

      {leadsQuery.isLoading ? (
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
          {t('common.loading')}
        </div>
      ) : null}

      {leadsQuery.isError ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {t('common.error')}
        </div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">{t('activeContacts.table.company')}</th>
              <th className="px-4 py-3 font-medium">{t('activeContacts.table.email')}</th>
              <th className="px-4 py-3 font-medium">{t('activeContacts.table.stage')}</th>
              <th className="px-4 py-3 font-medium">{t('activeContacts.table.nextActionAt')}</th>
              <th className="px-4 py-3 font-medium">{t('activeContacts.table.lastTouch')}</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-200 bg-white text-zinc-700">
            {activeContacts.map((lead) => {
              const overdue = new Date(lead.next_action_at).getTime() < nowTimestamp

              return (
                <tr key={lead.id} onClick={() => setSelectedLead(lead)} className="cursor-pointer transition hover:bg-zinc-50">
                  <td className="px-4 py-3 text-zinc-900">
                    <div className="font-medium">{lead.company_name}</div>
                    {lead.niche ? <div className="mt-1 text-xs text-zinc-500">{lead.niche}</div> : null}
                  </td>
                  <td className="px-4 py-3">{lead.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-700">
                      {t(`leads.filter.stage.${lead.stage}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className={overdue ? 'text-red-700' : 'text-zinc-700'}>
                      {new Date(lead.next_action_at).toLocaleString()}
                    </div>
                    {overdue ? <div className="mt-1 text-xs text-red-700">{t('activeContacts.table.overdue')}</div> : null}
                  </td>
                  <td className="px-4 py-3">{lead.last_touch_at ? new Date(lead.last_touch_at).toLocaleString() : '—'}</td>
                </tr>
              )
            })}

            {!leadsQuery.isLoading && !activeContacts.length ? (
              <tr>
                <td className="px-4 py-8 text-center text-sm text-zinc-500" colSpan={5}>
                  {t('activeContacts.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedLead ? <LeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} onLeadChange={setSelectedLead} /> : null}
    </section>
  )
}

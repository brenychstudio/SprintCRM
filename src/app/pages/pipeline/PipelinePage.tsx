import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LeadDrawer } from '../../features/leads/LeadDrawer'
import { leadsQueryKeys } from '../../../features/leads/leadsApi'
import type { Lead, LeadStage } from '../../../features/leads/types'
import { useI18n } from '../../../i18n/i18n'
import { supabase } from '../../../lib/supabase'

const activeStages: LeadStage[] = ['contacted', 'replied', 'proposal']
const secondaryStages: LeadStage[] = ['new', 'won', 'lost']

function stageTone(stage: LeadStage) {
  if (stage === 'proposal') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (stage === 'replied') return 'bg-blue-50 text-blue-700 border-blue-200'
  if (stage === 'contacted') return 'bg-zinc-100 text-zinc-700 border-zinc-200'
  if (stage === 'won') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (stage === 'lost') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-zinc-100 text-zinc-700 border-zinc-200'
}

function sortLeadsForBoard(leads: Lead[]) {
  return [...leads].sort((a, b) => {
    const aOverdue = new Date(a.next_action_at).getTime() < Date.now() ? 1 : 0
    const bOverdue = new Date(b.next_action_at).getTime() < Date.now() ? 1 : 0

    if (aOverdue !== bOverdue) return bOverdue - aOverdue

    return new Date(a.next_action_at).getTime() - new Date(b.next_action_at).getTime()
  })
}

function formatPipelineDate(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function PipelinePage() {
  const { t } = useI18n()
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [search, setSearch] = useState('')
  const [nicheFilter, setNicheFilter] = useState('__all')

  const leadsQuery = useQuery({
    queryKey: leadsQueryKeys.list({ scope: 'pipeline' }),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('status', 'active')
        .order('next_action_at', { ascending: true })

      if (error) throw error
      return (data ?? []) as Lead[]
    },
  })

  const nicheOptions = useMemo(() => {
    const values = new Set<string>()
    for (const lead of leadsQuery.data ?? []) {
      const value = lead.niche?.trim()
      if (value) values.add(value)
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }, [leadsQuery.data])

  const filteredLeads = useMemo(() => {
    const query = search.trim().toLowerCase()

    return (leadsQuery.data ?? []).filter((lead) => {
      const matchesSearch =
        !query ||
        [lead.company_name, lead.email ?? '', lead.website_domain ?? lead.website ?? '']
          .join(' ')
          .toLowerCase()
          .includes(query)

      const leadNiche = lead.niche?.trim() ?? ''
      const matchesNiche =
        nicheFilter === '__all'
          ? true
          : nicheFilter === '__unspecified'
            ? !leadNiche
            : leadNiche === nicheFilter

      return matchesSearch && matchesNiche
    })
  }, [leadsQuery.data, nicheFilter, search])

  const grouped = useMemo(() => {
    const base: Record<LeadStage, Lead[]> = {
      new: [],
      contacted: [],
      replied: [],
      proposal: [],
      won: [],
      lost: [],
    }

    for (const lead of filteredLeads) base[lead.stage].push(lead)

    for (const stage of Object.keys(base) as LeadStage[]) {
      base[stage] = sortLeadsForBoard(base[stage])
    }

    return base
  }, [filteredLeads])

  const summary = useMemo(() => {
    let overdue = 0
    let activeWork = 0

    for (const lead of filteredLeads) {
      if (new Date(lead.next_action_at).getTime() < Date.now()) overdue++
      if (activeStages.includes(lead.stage)) activeWork++
    }

    return {
      total: filteredLeads.length,
      activeWork,
      overdue,
      newCount: grouped.new.length,
      wonCount: grouped.won.length,
      lostCount: grouped.lost.length,
    }
  }, [filteredLeads, grouped])

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('pipeline.title')}</h1>
        <p className="mt-2 text-sm text-zinc-600">{t('pipeline.subtitle')}</p>
      </header>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 xl:col-span-2">
          <div className="text-xs text-zinc-500">{t('pipeline.kpi.activeWork')}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{summary.activeWork}</div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('pipeline.kpi.overdue')}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{summary.overdue}</div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('pipeline.stage.new')}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{summary.newCount}</div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('pipeline.stage.won')}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{summary.wonCount}</div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('pipeline.stage.lost')}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{summary.lostCount}</div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('pipeline.filters.searchPlaceholder')}
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"
        />

        <select
          value={nicheFilter}
          onChange={(event) => setNicheFilter(event.target.value)}
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"
        >
          <option value="__all">{t('pipeline.filters.nicheAll')}</option>
          <option value="__unspecified">{t('pipeline.filters.nicheUnspecified')}</option>
          {nicheOptions.map((niche) => (
            <option key={niche} value={niche}>
              {niche}
            </option>
          ))}
        </select>
      </div>

      {leadsQuery.isLoading ? (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
          {t('common.loading')}
        </div>
      ) : null}

      {leadsQuery.isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {t('common.error')}
        </div>
      ) : null}

      {!leadsQuery.isLoading && !filteredLeads.length ? (
        <p className="text-sm text-zinc-500">{t('pipeline.empty')}</p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-zinc-900">{t('pipeline.section.active.title')}</h2>
            <p className="mt-1 text-sm text-zinc-500">{t('pipeline.section.active.subtitle')}</p>
          </div>

          <div className="grid h-[72vh] min-h-[560px] max-h-[820px] gap-4 xl:grid-cols-3">
            {activeStages.map((stage) => (
              <section key={stage} className="flex min-h-0 flex-col rounded-2xl border border-zinc-200 bg-zinc-50">
                <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b border-zinc-200 bg-zinc-50/95 px-4 py-3 backdrop-blur">
                  <h3 className="text-sm font-semibold text-zinc-900">{t(`pipeline.stage.${stage}`)}</h3>
                  <span className={`rounded-full border px-2 py-1 text-[11px] ${stageTone(stage)}`}>{grouped[stage].length}</span>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                  <div className="space-y-3">
                    {grouped[stage].map((lead) => {
                      const overdue = new Date(lead.next_action_at).getTime() < Date.now()

                      return (
                        <article
                          key={lead.id}
                          className="rounded-2xl border border-zinc-200 bg-white p-3 transition hover:bg-zinc-50"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-zinc-900">{lead.company_name}</p>
                              {lead.niche ? <p className="mt-1 truncate text-xs text-zinc-500">{lead.niche}</p> : null}
                            </div>

                            <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] ${stageTone(stage)}`}>
                              {t(`pipeline.stage.${lead.stage}`)}
                            </span>
                          </div>

                          <div className="mt-3 space-y-1 text-xs">
                            <p className="text-zinc-500">
                              {t('pipeline.card.nextAction')}:{' '}
                              <span className="text-zinc-700">{t(`action.${lead.next_action}`)}</span>
                            </p>

                            <p className={overdue ? 'text-red-700' : 'text-zinc-500'}>
                              {t('pipeline.card.nextAt')}:{' '}
                              <span className={overdue ? 'text-red-700' : 'text-zinc-700'}>
                                {formatPipelineDate(lead.next_action_at)}
                              </span>
                            </p>
                          </div>

                          <div className="mt-3 flex justify-end">
                            <button
                              type="button"
                              onClick={() => setSelectedLead(lead)}
                              className="rounded-xl bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-zinc-800"
                            >
                              {t('pipeline.card.open')}
                            </button>
                          </div>
                        </article>
                      )
                    })}

                    {!grouped[stage].length ? (
                      <div className="rounded-xl border border-dashed border-zinc-200 px-3 py-6 text-center text-sm text-zinc-400">
                        {t('pipeline.emptyStage')}
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-zinc-900">{t('pipeline.section.secondary.title')}</h2>
            <p className="mt-1 text-sm text-zinc-500">{t('pipeline.section.secondary.subtitle')}</p>
          </div>

          <div className="space-y-4">
            {secondaryStages.map((stage) => (
              <section key={stage} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-900">{t(`pipeline.stage.${stage}`)}</h3>
                  <span className={`rounded-full border px-2 py-1 text-[11px] ${stageTone(stage)}`}>{grouped[stage].length}</span>
                </div>

                <div className="space-y-2">
                  {grouped[stage].slice(0, 5).map((lead) => {
                    const overdue = new Date(lead.next_action_at).getTime() < Date.now()

                    return (
                      <article key={lead.id} className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-zinc-900">{lead.company_name}</p>
                            <p className="mt-1 text-xs text-zinc-500">{formatPipelineDate(lead.next_action_at)}</p>
                          </div>

                          {overdue ? (
                            <span className="shrink-0 text-[11px] text-red-700">{t('pipeline.card.overdue')}</span>
                          ) : null}
                        </div>

                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setSelectedLead(lead)}
                            className="rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
                          >
                            {t('pipeline.card.open')}
                          </button>
                        </div>
                      </article>
                    )
                  })}

                  {!grouped[stage].length ? (
                    <div className="rounded-xl border border-dashed border-zinc-200 px-3 py-4 text-center text-sm text-zinc-400">
                      {t('pipeline.secondary.empty')}
                    </div>
                  ) : null}

                  {grouped[stage].length > 5 ? (
                    <div className="text-xs text-zinc-500">
                      {t('pipeline.secondary.more', { count: grouped[stage].length - 5 })}
                    </div>
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      {selectedLead ? (
        <LeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} onLeadChange={setSelectedLead} />
      ) : null}
    </section>
  )
}

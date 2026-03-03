import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LeadDrawer } from '../../features/leads/LeadDrawer'
import { defaultNextForStage, leadsQueryKeys, logActivity, updateLead } from '../../../features/leads/leadsApi'
import type { Lead, LeadStage } from '../../../features/leads/types'
import { useI18n } from '../../../i18n/i18n'
import { isoAtMadridNineAMInDays } from '../../../lib/dates'
import { supabase } from '../../../lib/supabase'

const stageOrder: LeadStage[] = ['new', 'contacted', 'replied', 'proposal', 'won', 'lost']

function milestoneForStage(stage: LeadStage): 'replied' | 'proposal_sent' | 'won' | 'lost' | null {
  if (stage === 'replied') return 'replied'
  if (stage === 'proposal') return 'proposal_sent'
  if (stage === 'won') return 'won'
  if (stage === 'lost') return 'lost'
  return null
}

export function PipelinePage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [search, setSearch] = useState('')
  const [nicheFilter, setNicheFilter] = useState('__all')

  const touchMutation = useMutation({
    mutationFn: async (lead: Lead) => {
      const updated = await updateLead(lead.id, { last_touch_at: new Date().toISOString() })
      await logActivity({ lead_id: lead.id, type: 'contacted', channel: 'email' })
      return updated
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
    },
  })

  const leadsQuery = useQuery({
    queryKey: leadsQueryKeys.list({}),
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

  const moveMutation = useMutation({
    mutationFn: async ({ lead, to }: { lead: Lead; to: LeadStage }) => {
      const next = defaultNextForStage(to)
      const nextActionAt = isoAtMadridNineAMInDays(next.days)

      const updated = await updateLead(lead.id, {
        stage: to,
        next_action: next.next_action,
        next_action_at: nextActionAt,
        last_touch_at: new Date().toISOString(),
      })

      if (lead.stage !== to) {
        await logActivity({
          lead_id: lead.id,
          type: 'stage_changed',
          meta: { from: lead.stage, to, next_action: next.next_action, next_action_at: nextActionAt },
        })

        const milestone = milestoneForStage(to)
        if (milestone) {
          await logActivity({ lead_id: lead.id, type: milestone })
        }
      }

      return updated
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
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
    return base
  }, [filteredLeads])

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('pipeline.title')}</h1>
      </header>

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
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">{t('common.loading')}</div>
      ) : null}
      {leadsQuery.isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{t('common.error')}</div>
      ) : null}

      {!leadsQuery.isLoading && !filteredLeads.length ? <p className="text-sm text-zinc-500">{t('pipeline.empty')}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {stageOrder.map((stage) => (
          <section key={stage} className="rounded-2xl border border-zinc-200 bg-white p-3">
            <h2 className="mb-3 text-sm font-semibold text-zinc-800">{t(`pipeline.stage.${stage}`)}</h2>

            <div className="space-y-3">
              {grouped[stage].map((lead) => {
                const overdue = new Date(lead.next_action_at).getTime() < Date.now()
                const isTerminal = lead.stage === 'won' || lead.stage === 'lost'
                const isBusy = moveMutation.isPending || touchMutation.isPending

                return (
                  <article
                    key={lead.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedLead(lead)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedLead(lead)
                      }
                    }}
                    className="cursor-pointer rounded-xl border border-zinc-200 bg-zinc-50 p-3 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20 focus-visible:ring-offset-2"
                  >
                    <p className="text-sm font-medium text-zinc-900">{lead.company_name}</p>
                    {lead.niche ? <p className="mt-1 text-xs text-zinc-500">{lead.niche}</p> : null}

                    <p className="mt-2 text-xs text-zinc-500">
                      {t('pipeline.card.nextAction')}: <span className="text-zinc-700">{t(`action.${lead.next_action}`)}</span>
                    </p>
                    <p className="text-xs text-zinc-500">
                      {t('pipeline.card.nextAt')}: <span className="text-zinc-700">{new Date(lead.next_action_at).toLocaleString()}</span>
                    </p>

                    {overdue ? (
                      <span className="mt-2 inline-flex rounded-full bg-red-50 px-2 py-1 text-[11px] text-red-700">{t('pipeline.card.overdue')}</span>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          touchMutation.mutate(lead)
                        }}
                        disabled={isBusy}
                        className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20 focus-visible:ring-offset-2"
                      >
                        {t('drawer.logTouch')}
                      </button>

                      <span className="h-4 w-px bg-zinc-200" aria-hidden="true" />

                      {(['contacted', 'replied', 'proposal'] as LeadStage[]).map((target) => (
                        <button
                          key={target}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            moveMutation.mutate({ lead, to: target })
                          }}
                          disabled={isBusy || isTerminal || lead.stage === target}
                          className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20 focus-visible:ring-offset-2"
                        >
                          {t(`pipeline.stage.${target}`)}
                        </button>
                      ))}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {selectedLead ? <LeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} onLeadChange={setSelectedLead} /> : null}
    </section>
  )
}
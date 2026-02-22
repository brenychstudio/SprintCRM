import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { defaultNextForStage, leadsQueryKeys, logActivity, updateLead } from '../../../features/leads/leadsApi'
import type { Lead, LeadStage } from '../../../features/leads/types'
import { useI18n } from '../../../i18n/i18n'
import { isoAtMadridNineAMInDays } from '../../../lib/dates'
import { supabase } from '../../../lib/supabase'

const stageOrder: LeadStage[] = ['new', 'contacted', 'replied', 'proposal', 'won', 'lost']
const moveTargets: LeadStage[] = ['new', 'contacted', 'replied', 'proposal', 'won', 'lost']

export function PipelinePage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

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

      await logActivity({
        lead_id: lead.id,
        type: 'stage_changed',
        meta: { from: lead.stage, to, next_action: next.next_action, next_action_at: nextActionAt },
      })

      return updated
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
    },
  })

  const grouped = useMemo(() => {
    const base: Record<LeadStage, Lead[]> = {
      new: [], contacted: [], replied: [], proposal: [], won: [], lost: [],
    }
    for (const lead of leadsQuery.data ?? []) base[lead.stage].push(lead)
    return base
  }, [leadsQuery.data])

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('pipeline.title')}</h1>
      </header>

      {leadsQuery.isLoading ? <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">{t('common.loading')}</div> : null}
      {leadsQuery.isError ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{t('common.error')}</div> : null}

      {!leadsQuery.isLoading && !leadsQuery.data?.length ? <p className="text-sm text-zinc-500">{t('pipeline.empty')}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {stageOrder.map((stage) => (
          <section key={stage} className="rounded-2xl border border-zinc-200 bg-white p-3">
            <h2 className="mb-3 text-sm font-semibold text-zinc-800">{t(`pipeline.stage.${stage}`)}</h2>

            <div className="space-y-3">
              {grouped[stage].map((lead) => {
                const overdue = new Date(lead.next_action_at).getTime() < Date.now()
                return (
                  <article key={lead.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                    <p className="text-sm font-medium text-zinc-900">{lead.company_name}</p>
                    {lead.niche ? <p className="mt-1 text-xs text-zinc-500">{lead.niche}</p> : null}

                    <p className="mt-2 text-xs text-zinc-500">{t('pipeline.card.nextAction')}: <span className="text-zinc-700">{t(`action.${lead.next_action}`)}</span></p>
                    <p className="text-xs text-zinc-500">{t('pipeline.card.nextAt')}: <span className="text-zinc-700">{new Date(lead.next_action_at).toLocaleString()}</span></p>

                    {overdue ? <span className="mt-2 inline-flex rounded-full bg-red-50 px-2 py-1 text-[11px] text-red-700">{t('pipeline.card.overdue')}</span> : null}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => navigate('/leads')} className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-700">{t('pipeline.action.open')}</button>
                      <span className="self-center text-[11px] text-zinc-500">{t('pipeline.action.move')}</span>
                      {moveTargets.filter((target) => target !== lead.stage).slice(0, 2).map((target) => (
                        <button
                          key={target}
                          type="button"
                          onClick={() => moveMutation.mutate({ lead, to: target })}
                          disabled={moveMutation.isPending}
                          className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-700 disabled:opacity-50"
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
    </section>
  )
}

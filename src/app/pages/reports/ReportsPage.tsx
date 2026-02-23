import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../../../i18n/i18n'
import { supabase } from '../../../lib/supabase'

type RangePreset = '7d' | '30d' | 'all'

type ActivityType = 'contacted' | 'replied' | 'proposal_sent' | 'won' | 'lost'

function sinceIso(range: RangePreset): string | null {
  if (range === 'all') return null
  const days = range === '7d' ? 7 : 30
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function ratio(numerator: number, denominator: number): string {
  if (!denominator) return '0%'
  return `${Math.round((numerator / denominator) * 100)}%`
}

export function ReportsPage() {
  const { t } = useI18n()
  const [range, setRange] = useState<RangePreset>('30d')

  const reportQuery = useQuery({
    queryKey: ['reports', range],
    queryFn: async () => {
      const since = sinceIso(range)
      let activitiesQuery = supabase
        .from('activities')
        .select('type, at')
        .in('type', ['contacted', 'replied', 'proposal_sent', 'won', 'lost'])

      if (since) activitiesQuery = activitiesQuery.gte('at', since)

      const [activitiesRes, activeRes, overdueRes] = await Promise.all([
        activitiesQuery,
        supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active')
          .lt('next_action_at', new Date().toISOString()),
      ])

      if (activitiesRes.error) throw activitiesRes.error
      if (activeRes.error) throw activeRes.error
      if (overdueRes.error) throw overdueRes.error

      const counters: Record<ActivityType, number> = {
        contacted: 0,
        replied: 0,
        proposal_sent: 0,
        won: 0,
        lost: 0,
      }

      for (const row of activitiesRes.data ?? []) {
        const type = row.type as ActivityType
        if (type in counters) counters[type] += 1
      }

      return {
        ...counters,
        active: activeRes.count ?? 0,
        overdue: overdueRes.count ?? 0,
      }
    },
  })

  const funnelRows = useMemo(() => {
    const m = reportQuery.data
    const contacted = m?.contacted ?? 0
    const replied = m?.replied ?? 0
    const proposal = m?.proposal_sent ?? 0
    const won = m?.won ?? 0

    return [
      { key: 'contacted', count: contacted, conversion: '100%' },
      { key: 'replied', count: replied, conversion: ratio(replied, contacted) },
      { key: 'proposal', count: proposal, conversion: ratio(proposal, replied) },
      { key: 'won', count: won, conversion: ratio(won, proposal) },
    ]
  }, [reportQuery.data])

  return (
    <section>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('reports.title')}</h1>
        <div className="flex gap-2">
          {(['7d', '30d', 'all'] as RangePreset[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setRange(item)}
              className={`rounded-xl border px-3 py-2 text-sm ${
                range === item ? 'border-zinc-300 bg-zinc-100 text-zinc-900' : 'border-zinc-200 bg-white text-zinc-600'
              }`}
            >
              {t(`reports.range.${item}`)}
            </button>
          ))}
        </div>
      </header>

      {reportQuery.isLoading ? <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">{t('common.loading')}</div> : null}
      {reportQuery.isError ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{t('common.error')}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {[['contacted', 'reports.kpi.contacted'], ['replied', 'reports.kpi.replied'], ['proposal_sent', 'reports.kpi.proposals'], ['won', 'reports.kpi.won'], ['lost', 'reports.kpi.lost'], ['active', 'reports.kpi.active'], ['overdue', 'reports.kpi.overdue']].map(([key, label]) => (
          <div key={key} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
            <p className="text-xs text-zinc-500">{t(label)}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900">{reportQuery.data?.[key as keyof typeof reportQuery.data] ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">{t('reports.section.funnel')}</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">{t('reports.funnel.header.step')}</th>
                <th className="px-3 py-2 font-medium">{t('reports.funnel.header.count')}</th>
                <th className="px-3 py-2 font-medium">{t('reports.funnel.header.conversion')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 bg-white text-zinc-700">
              {funnelRows.map((row) => (
                <tr key={row.key}>
                  <td className="px-3 py-2">{t(`reports.funnel.${row.key}`)}</td>
                  <td className="px-3 py-2">{row.count}</td>
                  <td className="px-3 py-2">{row.conversion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

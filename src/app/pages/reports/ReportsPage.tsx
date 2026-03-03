import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../../../i18n/i18n'
import { supabase } from '../../../lib/supabase'

type RangePreset = '7d' | '30d' | 'all'

type ActivityType = 'imported' | 'contacted' | 'replied' | 'proposal_sent' | 'won' | 'lost'

type LeadLite = {
  id: string
  niche: string | null
  source_file: string | null
}

type NicheRow = {
  key: string
  contacted: number
  replied: number
  proposals: number
  won: number
}

type SourceRow = {
  key: string
  imported: number
  contacted: number
  replied: number
  proposals: number
  won: number
}

type StageRow = {
  stage: string
  overdue: number
}


type ReportsData = {
  contacted: number
  replied: number
  proposal_sent: number
  won: number
  lost: number
  active: number
  overdue: number
  topNiches: NicheRow[]
  topSources: SourceRow[]
  overdueByStage: StageRow[]
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

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

  const reportQuery = useQuery<ReportsData>({
    queryKey: ['reports', range],
    queryFn: async () => {
      const since = sinceIso(range)
      const nowIso = new Date().toISOString()

      let activitiesQuery = supabase
        .from('activities')
        .select('lead_id, type, at')
        .in('type', ['imported', 'contacted', 'replied', 'proposal_sent', 'won', 'lost'])

      if (since) activitiesQuery = activitiesQuery.gte('at', since)

      const [activitiesRes, activeRes, overdueStagesRes] = await Promise.all([
        activitiesQuery,
        supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('leads').select('stage', { count: 'exact' }).eq('status', 'active').lt('next_action_at', nowIso),
      ])

      if (activitiesRes.error) throw activitiesRes.error
      if (activeRes.error) throw activeRes.error
      if (overdueStagesRes.error) throw overdueStagesRes.error

      const kpiCounters: Record<Exclude<ActivityType, 'imported'>, number> = {
        contacted: 0,
        replied: 0,
        proposal_sent: 0,
        won: 0,
        lost: 0,
      }

      const leadIds: string[] = []

      for (const row of activitiesRes.data ?? []) {
        const type = row.type as ActivityType
        if (type !== 'imported') kpiCounters[type] += 1
        if (row.lead_id) leadIds.push(row.lead_id)
      }

      const uniqueLeadIds = Array.from(new Set(leadIds))
      const leadsById = new Map<string, LeadLite>()

      for (const ids of chunk(uniqueLeadIds, 200)) {
        const { data, error } = await supabase.from('leads').select('id, niche, source_file').in('id', ids)
        if (error) throw error
        for (const lead of (data ?? []) as LeadLite[]) leadsById.set(lead.id, lead)
      }

      const nicheAgg = new Map<string, Omit<NicheRow, 'key'>>()
      const sourceAgg = new Map<string, Omit<SourceRow, 'key'>>()

      function ensureNiche(key: string) {
        if (!nicheAgg.has(key)) nicheAgg.set(key, { contacted: 0, replied: 0, proposals: 0, won: 0 })
        return nicheAgg.get(key)!
      }

      function ensureSource(key: string) {
        if (!sourceAgg.has(key)) sourceAgg.set(key, { imported: 0, contacted: 0, replied: 0, proposals: 0, won: 0 })
        return sourceAgg.get(key)!
      }

      for (const row of activitiesRes.data ?? []) {
        const type = row.type as ActivityType
        const lead = row.lead_id ? leadsById.get(row.lead_id) : undefined
        const nicheKey = lead?.niche?.trim() ? lead.niche.trim() : '__unspecified'
        const sourceKey = lead?.source_file?.trim() ? lead.source_file.trim() : '__unspecified'

        // Top niches: contacted/replied/proposals/won
        if (type === 'contacted' || type === 'replied' || type === 'proposal_sent' || type === 'won') {
          const n = ensureNiche(nicheKey)
          if (type === 'contacted') n.contacted += 1
          if (type === 'replied') n.replied += 1
          if (type === 'proposal_sent') n.proposals += 1
          if (type === 'won') n.won += 1
        }

        // Top sources: imported + contacted/replied/proposals/won
        if (type === 'imported' || type === 'contacted' || type === 'replied' || type === 'proposal_sent' || type === 'won') {
          const s = ensureSource(sourceKey)
          if (type === 'imported') s.imported += 1
          if (type === 'contacted') s.contacted += 1
          if (type === 'replied') s.replied += 1
          if (type === 'proposal_sent') s.proposals += 1
          if (type === 'won') s.won += 1
        }
      }

      const topNiches: NicheRow[] = Array.from(nicheAgg.entries())
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => (b.contacted - a.contacted) || (b.won - a.won) || (b.replied - a.replied))
        .slice(0, 10)

      const topSources: SourceRow[] = Array.from(sourceAgg.entries())
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => (b.imported - a.imported) || (b.contacted - a.contacted) || (b.won - a.won))
        .slice(0, 10)

      const overdueByStageMap = new Map<string, number>()
      for (const row of overdueStagesRes.data ?? []) {
        const stage = (row as { stage: string }).stage
        overdueByStageMap.set(stage, (overdueByStageMap.get(stage) ?? 0) + 1)
      }

      const overdueByStage: StageRow[] = Array.from(overdueByStageMap.entries())
        .map(([stage, overdue]) => ({ stage, overdue }))
        .sort((a, b) => b.overdue - a.overdue)

      return {
        ...kpiCounters,
        active: activeRes.count ?? 0,
        overdue: overdueStagesRes.count ?? 0,
        topNiches,
        topSources,
        overdueByStage,
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

      {reportQuery.isLoading ? (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">{t('common.loading')}</div>
      ) : null}
      {reportQuery.isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{t('common.error')}</div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {([
          ['contacted', 'reports.kpi.contacted'],
          ['replied', 'reports.kpi.replied'],
          ['proposal_sent', 'reports.kpi.proposals'],
          ['won', 'reports.kpi.won'],
          ['lost', 'reports.kpi.lost'],
          ['active', 'reports.kpi.active'],
          ['overdue', 'reports.kpi.overdue'],
        ] as const).map(([key, label]) => (
          <div key={key} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
            <p className="text-xs text-zinc-500">{t(label)}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900">{reportQuery.data?.[key] ?? 0}</p>
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

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-900">{t('reports.section.top_niches')}</h2>
          <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('reports.table.niche')}</th>
                  <th className="px-3 py-2 font-medium">{t('reports.kpi.contacted')}</th>
                  <th className="px-3 py-2 font-medium">{t('reports.kpi.replied')}</th>
                  <th className="px-3 py-2 font-medium">{t('reports.kpi.proposals')}</th>
                  <th className="px-3 py-2 font-medium">{t('reports.kpi.won')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 bg-white text-zinc-700">
                {(reportQuery.data?.topNiches ?? []).map((row) => (
                  <tr key={row.key}>
                    <td className="px-3 py-2">{row.key === '__unspecified' ? t('reports.unspecified') : row.key}</td>
                    <td className="px-3 py-2">{row.contacted}</td>
                    <td className="px-3 py-2">{row.replied}</td>
                    <td className="px-3 py-2">{row.proposals}</td>
                    <td className="px-3 py-2">{row.won}</td>
                  </tr>
                ))}
                {!reportQuery.isLoading && !(reportQuery.data?.topNiches ?? []).length ? (
                  <tr>
                    <td className="px-3 py-3 text-sm text-zinc-500" colSpan={5}>
                      {t('pipeline.empty')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-900">{t('reports.section.top_sources')}</h2>
          <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('reports.table.source')}</th>
                  <th className="px-3 py-2 font-medium">{t('activity.imported')}</th>
                  <th className="px-3 py-2 font-medium">{t('reports.kpi.contacted')}</th>
                  <th className="px-3 py-2 font-medium">{t('reports.kpi.replied')}</th>
                  <th className="px-3 py-2 font-medium">{t('reports.kpi.proposals')}</th>
                  <th className="px-3 py-2 font-medium">{t('reports.kpi.won')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 bg-white text-zinc-700">
                {(reportQuery.data?.topSources ?? []).map((row) => (
                  <tr key={row.key}>
                    <td className="px-3 py-2">{row.key === '__unspecified' ? t('reports.unspecified') : row.key}</td>
                    <td className="px-3 py-2">{row.imported}</td>
                    <td className="px-3 py-2">{row.contacted}</td>
                    <td className="px-3 py-2">{row.replied}</td>
                    <td className="px-3 py-2">{row.proposals}</td>
                    <td className="px-3 py-2">{row.won}</td>
                  </tr>
                ))}
                {!reportQuery.isLoading && !(reportQuery.data?.topSources ?? []).length ? (
                  <tr>
                    <td className="px-3 py-3 text-sm text-zinc-500" colSpan={6}>
                      {t('pipeline.empty')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-900">{t('reports.section.overdue_health')}</h2>
          <p className="text-sm text-zinc-600">
            {t('reports.kpi.overdue')}: <span className="font-medium text-zinc-900">{reportQuery.data?.overdue ?? 0}</span>
            <span className="mx-2 text-zinc-300">•</span>
            {t('reports.kpi.active')}: <span className="font-medium text-zinc-900">{reportQuery.data?.active ?? 0}</span>
            <span className="mx-2 text-zinc-300">•</span>
            {t('reports.table.overdue_percent')}: <span className="font-medium text-zinc-900">{ratio(reportQuery.data?.overdue ?? 0, reportQuery.data?.active ?? 0)}</span>
          </p>
        </header>

        <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">{t('leads.table.stage')}</th>
                <th className="px-3 py-2 font-medium">{t('reports.funnel.header.count')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 bg-white text-zinc-700">
              {(reportQuery.data?.overdueByStage ?? []).map((row) => (
                <tr key={row.stage}>
                  <td className="px-3 py-2">{t(`pipeline.stage.${row.stage}`)}</td>
                  <td className="px-3 py-2">{row.overdue}</td>
                </tr>
              ))}
              {!reportQuery.isLoading && !(reportQuery.data?.overdueByStage ?? []).length ? (
                <tr>
                  <td className="px-3 py-3 text-sm text-zinc-500" colSpan={2}>
                    {t('pipeline.empty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}

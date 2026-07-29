import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { campaignQueryKeys, outreachTaskCounts } from '../../../features/campaigns/campaignsApi'
import { useI18n } from '../../../i18n/i18n'

export function OutreachTodaySummary() {
  const { t } = useI18n()
  const outreachQuery = useQuery({ queryKey: campaignQueryKeys.tasks(), queryFn: outreachTaskCounts })
  const counts = outreachQuery.data ?? { needsReview: 0, researchRequired: 0, needsAttention: 0 }
  const hasActionableTasks = counts.needsReview + counts.researchRequired + counts.needsAttention > 0
  return (
    <section className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-5" data-testid="today-outreach-summary">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-sm font-semibold text-zinc-900">{t('today.outreach.title')}</h2><p className="mt-1 text-sm text-zinc-600">{hasActionableTasks ? t('today.outreach.summary', { review: counts.needsReview, research: counts.researchRequired, attention: counts.needsAttention }) : t('today.outreach.empty')}</p></div>
        {hasActionableTasks ? <Link to="/campaigns" className="rounded-xl bg-zinc-900 px-3 py-2 text-center text-sm font-medium text-white">{t('today.outreach.open')}</Link> : <button type="button" disabled aria-disabled="true" data-testid="today-outreach-open-disabled" className="cursor-not-allowed rounded-xl bg-zinc-300 px-3 py-2 text-center text-sm font-medium text-zinc-600">{t('today.outreach.open')}</button>}
      </div>
    </section>
  )
}

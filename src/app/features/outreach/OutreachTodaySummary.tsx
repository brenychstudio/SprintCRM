import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { campaignQueryKeys, outreachTaskCounts } from '../../../features/campaigns/campaignsApi'
import { useI18n } from '../../../i18n/i18n'

export function OutreachTodaySummary() {
  const { t } = useI18n()
  const outreachQuery = useQuery({ queryKey: campaignQueryKeys.tasks(), queryFn: outreachTaskCounts })
  return (
    <section className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-5" data-testid="today-outreach-summary">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-sm font-semibold text-zinc-900">{t('today.outreach.title')}</h2><p className="mt-1 text-sm text-zinc-600">{t('today.outreach.summary', { review: outreachQuery.data?.needsReview ?? 0, research: outreachQuery.data?.researchRequired ?? 0, attention: outreachQuery.data?.needsAttention ?? 0 })}</p></div>
        <Link to="/campaigns" className="rounded-xl bg-zinc-900 px-3 py-2 text-center text-sm font-medium text-white">{t('today.outreach.open')}</Link>
      </div>
    </section>
  )
}

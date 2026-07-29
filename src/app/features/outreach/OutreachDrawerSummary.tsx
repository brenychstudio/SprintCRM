import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { campaignQueryKeys, listCampaignSummariesForLead } from '../../../features/campaigns/campaignsApi'
import { featureFlags } from '../../../features/featureFlags/featureFlags'
import { useI18n } from '../../../i18n/i18n'

export function OutreachDrawerSummary({ leadId }: { leadId: string }) {
  const { t } = useI18n()
  const query = useQuery({
    queryKey: campaignQueryKeys.leadSummary(leadId),
    queryFn: () => listCampaignSummariesForLead(leadId),
    enabled: featureFlags.outreach_ops_enabled,
  })
  if (!featureFlags.outreach_ops_enabled || !query.data?.length) return null
  const current = query.data.find((item) => !['skipped', 'sent', 'replied'].includes(item.member.status)) ?? query.data[0]
  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-5" data-testid="drawer-outreach-summary">
      <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-zinc-900">{t('drawer.outreach.title')}</h3><p className="mt-1 text-xs text-zinc-500">{query.data.length > 1 ? t('drawer.outreach.multiple', { count: query.data.length }) : current.campaign.name}</p></div><Link to={'/campaigns/' + current.campaign.id + '/review/' + current.member.id} className="rounded-xl bg-zinc-900 px-3 py-2 text-xs font-medium text-white">{t('drawer.outreach.open')}</Link></div>
      <dl className="mt-4 grid gap-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-zinc-500">{t('drawer.outreach.campaign')}</dt><dd className="truncate font-medium text-zinc-800">{current.campaign.name}</dd></div><div className="flex justify-between gap-3"><dt className="text-zinc-500">{t('drawer.outreach.status')}</dt><dd className="font-medium text-zinc-800">{t('campaigns.memberStatus.' + current.member.status)}</dd></div><div className="flex justify-between gap-3"><dt className="text-zinc-500">{t('drawer.outreach.research')}</dt><dd className="font-medium text-zinc-800">{current.latestResearch ? t('campaigns.version', { version: current.latestResearch.version }) : t('campaigns.none')}</dd></div><div className="flex justify-between gap-3"><dt className="text-zinc-500">{t('drawer.outreach.message')}</dt><dd className="font-medium text-zinc-800">{current.latestMessage ? t('campaigns.version', { version: current.latestMessage.version }) : t('campaigns.none')}</dd></div></dl>
    </section>
  )
}

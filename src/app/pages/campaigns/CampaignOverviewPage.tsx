import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { campaignQueryKeys, getCampaign, listCampaignMembersWithContext, skipCampaignMember } from '../../../features/campaigns/campaignsApi'
import type { EligibilityResult } from '../../../features/campaigns/types'
import { campaignProgress, reviewQueue } from '../../../features/campaigns/workflow'
import { useI18n } from '../../../i18n/i18n'

export function CampaignOverviewPage() {
  const { campaignId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const campaignQuery = useQuery({ queryKey: campaignQueryKeys.detail(campaignId!), queryFn: () => getCampaign(campaignId!), enabled: Boolean(campaignId) })
  const membersQuery = useQuery({ queryKey: campaignQueryKeys.members(campaignId!), queryFn: () => listCampaignMembersWithContext(campaignId!), enabled: Boolean(campaignId) })
  const skipMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => skipCampaignMember(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignQueryKeys.all }),
  })

  if (campaignQuery.isLoading || membersQuery.isLoading) return <p className="text-sm text-zinc-500">{t('campaigns.loading')}</p>
  if (campaignQuery.isError || !campaignQuery.data) return <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{t('campaigns.notFound')}</p>

  const campaign = campaignQuery.data
  const members = membersQuery.data ?? []
  const progress = campaignProgress(members)
  const firstReview = reviewQueue(members).at(0)
  const eligibility = ((location.state as { eligibility?: EligibilityResult[] } | null)?.eligibility ?? [])

  return (
    <section data-testid="campaign-overview">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold text-zinc-900">{campaign.name}</h1><span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">{t('campaigns.status.' + campaign.status)}</span></div><p className="mt-2 text-sm text-zinc-600">{campaign.target_segment || t('campaigns.unspecified')}</p></div>
        <div className="flex flex-wrap gap-2"><Link to={'/campaigns/' + campaign.id + '/edit'} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700">{t('campaigns.edit')}</Link><button data-testid="campaign-start-review" disabled={!firstReview} onClick={() => firstReview && navigate('/campaigns/' + campaign.id + '/review/' + firstReview.id)} className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{t('campaigns.startReview')}</button></div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[
        ['toPrepare', progress.toPrepare], ['needsReview', progress.needsReview], ['ready', progress.ready], ['sent', progress.sent], ['needsAttention', progress.needsAttention],
      ].map(([key, value]) => <div key={String(key)} className="rounded-2xl border border-zinc-200 bg-white p-4"><div className="text-xs text-zinc-500">{t('campaigns.progress.' + key)}</div><div className="mt-2 text-2xl font-semibold text-zinc-900">{value}</div></div>)}</div>

      {eligibility.length ? <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-medium">{t('campaigns.addLeadResults', { count: eligibility.length })}</p><ul className="mt-2 list-disc space-y-1 pl-5">{eligibility.map((item) => <li key={item.lead_id}>{t('campaigns.eligibility.' + item.outcome)}{item.reason ? ': ' + item.reason : ''}</li>)}</ul></div> : null}

      <div className="mt-6 overflow-hidden rounded-3xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-5 py-4"><h2 className="text-base font-semibold text-zinc-900">{t('campaigns.members.title')}</h2><p className="mt-1 text-sm text-zinc-500">{t('campaigns.members.subtitle')}</p></div>
        {!members.length ? <div className="p-8 text-center text-sm text-zinc-500">{t('campaigns.members.empty')}</div> : <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-zinc-50 text-xs uppercase text-zinc-500"><tr><th className="px-4 py-3">{t('campaigns.members.lead')}</th><th className="px-4 py-3">{t('campaigns.members.status')}</th><th className="px-4 py-3">{t('campaigns.members.research')}</th><th className="px-4 py-3">{t('campaigns.members.message')}</th><th className="px-4 py-3 text-right">{t('campaigns.members.actions')}</th></tr></thead><tbody className="divide-y divide-zinc-200">{members.map((member) => <tr key={member.id}><td className="px-4 py-4"><strong className="block text-zinc-900">{member.lead?.company_name || t('campaigns.memberUnavailable')}</strong><span className="text-xs text-zinc-500">{member.lead?.email || member.lead?.website || ''}</span></td><td className="px-4 py-4"><span className="rounded-full bg-zinc-100 px-2 py-1 text-xs">{t('campaigns.memberStatus.' + member.status)}</span></td><td className="px-4 py-4 text-zinc-600">{member.latestResearch ? t('campaigns.version', { version: member.latestResearch.version }) : t('campaigns.none')}</td><td className="px-4 py-4 text-zinc-600">{member.latestMessage ? t('campaigns.version', { version: member.latestMessage.version }) : t('campaigns.none')}</td><td className="px-4 py-4"><div className="flex justify-end gap-2"><Link to={'/campaigns/' + campaign.id + '/review/' + member.id} className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white">{t('campaigns.open')}</Link>{!['skipped', 'sent', 'replied'].includes(member.status) ? <button data-testid="member-skip" type="button" onClick={() => { const reason = window.prompt(t('campaigns.skipPrompt')); if (reason !== null) skipMutation.mutate({ id: member.id, reason }) }} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700">{t('campaigns.skip')}</button> : null}</div></td></tr>)}</tbody></table></div>}
      </div>
    </section>
  )
}

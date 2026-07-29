import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { campaignQueryKeys, listCampaignMembers } from '../../../features/campaigns/campaignsApi'
import { nextReviewMemberId } from '../../../features/campaigns/workflow'
import { useI18n } from '../../../i18n/i18n'

export function CampaignReviewStartPage() {
  const { campaignId } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const query = useQuery({ queryKey: campaignQueryKeys.members(campaignId!), queryFn: () => listCampaignMembers(campaignId!), enabled: Boolean(campaignId) })
  useEffect(() => {
    const next = nextReviewMemberId(query.data ?? [])
    if (next) navigate('/campaigns/' + campaignId + '/review/' + next, { replace: true })
  }, [campaignId, navigate, query.data])
  if (query.isLoading) return <p className="text-sm text-zinc-500">{t('campaigns.loading')}</p>
  if (!nextReviewMemberId(query.data ?? [])) return <p className="rounded-2xl bg-zinc-50 p-5 text-sm text-zinc-600">{t('campaigns.reviewEmpty')}</p>
  return null
}

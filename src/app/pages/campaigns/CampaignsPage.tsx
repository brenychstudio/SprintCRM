import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { campaignQueryKeys, listCampaigns, updateCampaign } from '../../../features/campaigns/campaignsApi'
import { useI18n } from '../../../i18n/i18n'

export function CampaignsPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const campaignsQuery = useQuery({ queryKey: campaignQueryKeys.list(), queryFn: listCampaigns })
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'paused' | 'archived' }) => {
      const campaign = campaignsQuery.data?.find((item) => item.id === id)
      if (!campaign) throw new Error('Campaign is unavailable.')
      return updateCampaign(id, {
        name: campaign.name,
        description: campaign.description ?? undefined,
        target_segment: campaign.target_segment ?? undefined,
        offer_summary: campaign.offer_summary ?? undefined,
        default_channel: campaign.default_channel,
        default_language: campaign.default_language,
        tone: campaign.tone ?? undefined,
        proof_context: campaign.proof_context ?? undefined,
        status,
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignQueryKeys.all }),
  })

  if (campaignsQuery.isLoading) return <p className="text-sm text-zinc-500">{t('campaigns.loading')}</p>
  if (campaignsQuery.isError) return <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{t('campaigns.error')}</p>

  const campaigns = campaignsQuery.data ?? []

  return (
    <section data-testid="campaign-list">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">{t('campaigns.title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600">{t('campaigns.subtitle')}</p>
        </div>
        <Link data-testid="campaign-create" to="/campaigns/new" className="rounded-2xl bg-zinc-900 px-4 py-3 text-center text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800">
          {t('campaigns.create')}
        </Link>
      </div>

      {!campaigns.length ? (
        <div className="mt-8 rounded-3xl border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center">
          <h2 className="text-lg font-semibold text-zinc-900">{t('campaigns.empty.title')}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-600">{t('campaigns.empty.subtitle')}</p>
          <Link to="/campaigns/new" className="mt-5 inline-flex rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white">
            {t('campaigns.create')}
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {campaigns.map((campaign) => (
            <article key={campaign.id} className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-zinc-900">{campaign.name}</h2>
                    <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">{t('campaigns.status.' + campaign.status)}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-zinc-600">{campaign.target_segment || t('campaigns.unspecified')}</p>
                  <p className="mt-3 text-xs text-zinc-500">{t('campaigns.updated', { date: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(campaign.updated_at)) })}</p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to={'/campaigns/' + campaign.id} className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white">{t('campaigns.open')}</Link>
                <Link to={'/campaigns/' + campaign.id + '/review'} data-testid="campaign-start-review" className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700">{t('campaigns.startReview')}</Link>
                {campaign.status === 'active' ? <button type="button" onClick={() => statusMutation.mutate({ id: campaign.id, status: 'paused' })} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700">{t('campaigns.pause')}</button> : null}
                {campaign.status === 'paused' ? <button type="button" onClick={() => statusMutation.mutate({ id: campaign.id, status: 'active' })} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700">{t('campaigns.resume')}</button> : null}
                {campaign.status !== 'archived' ? <button type="button" onClick={() => statusMutation.mutate({ id: campaign.id, status: 'archived' })} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700">{t('campaigns.archive')}</button> : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

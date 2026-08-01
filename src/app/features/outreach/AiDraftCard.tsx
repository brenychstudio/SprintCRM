import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { campaignQueryKeys, generateAiDraft, getLatestAiDraftJob } from '../../../features/campaigns/campaignsApi'
import type { AiDraftResult, CampaignMemberStatus, OutboundMessage, ResearchSnapshot } from '../../../features/campaigns/types'
import { useI18n } from '../../../i18n/i18n'

const allowedStates: CampaignMemberStatus[] = ['research_ready', 'draft_ready']

export function AiDraftCard({ memberId, campaignId, leadId, memberStatus, latestResearch, latestMessage }: { memberId: string; campaignId: string; leadId: string; memberStatus: CampaignMemberStatus; latestResearch: ResearchSnapshot | null; latestMessage: OutboundMessage | null }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [confirmedResearchId, setConfirmedResearchId] = useState<string | null>(null)
  const [completed, setCompleted] = useState<AiDraftResult | null>(null)
  const jobQuery = useQuery({ queryKey: campaignQueryKeys.aiDraft(memberId), queryFn: () => getLatestAiDraftJob(memberId) })
  const mutation = useMutation({
    mutationFn: ({ requestId }: { requestId: string }) => generateAiDraft(memberId, latestResearch!.id, requestId),
    onSuccess: (result) => {
      setCompleted(result)
      queryClient.invalidateQueries({ queryKey: campaignQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: campaignQueryKeys.aiDraft(memberId) })
      queryClient.invalidateQueries({ queryKey: campaignQueryKeys.workspace(campaignId, memberId) })
      queryClient.invalidateQueries({ queryKey: campaignQueryKeys.detail(campaignId) })
      queryClient.invalidateQueries({ queryKey: campaignQueryKeys.members(campaignId) })
      queryClient.invalidateQueries({ queryKey: campaignQueryKeys.leadSummary(leadId) })
    },
  })
  const latestJob = jobQuery.data
  const isAllowed = allowedStates.includes(memberStatus)
  const researchChanged = Boolean(confirmedResearchId && confirmedResearchId !== latestResearch?.id)
  const latestJobMatchesResearch = latestJob?.generation_status === 'completed' && latestMessage?.ai_generation_id === latestJob.id && latestMessage.research_snapshot_id === latestResearch?.id
  const currentCompleted = completed?.research_version === latestResearch?.version ? completed : null
  const status = mutation.isPending ? 'generating' : researchChanged ? 'researchChanged' : mutation.isError || latestJob?.generation_status === 'failed' ? 'failed' : (currentCompleted || latestJobMatchesResearch) ? 'completed' : !latestResearch ? 'researchRequired' : !confirmedResearchId ? 'confirmationRequired' : 'ready'
  const metadata = currentCompleted ?? (latestJobMatchesResearch ? {
    model: latestJob.model_name ?? '', usage: { total_tokens: latestJob.total_tokens ?? 0 }, duration_ms: latestJob.duration_ms ?? 0,
    request_id: latestJob.request_id ?? latestJob.id, message_version: latestMessage?.ai_generation_id === latestJob.id ? latestMessage.version : 0, research_version: latestResearch?.version ?? 0,
  } : null)
  return <section data-testid="ai-draft" className="min-w-0 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-semibold text-zinc-900 dark:text-zinc-100">{t('campaigns.aiDraft.title')}</h2><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('campaigns.aiDraft.status')}: {t('campaigns.aiDraft.' + status)}</p>{latestResearch ? <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{t('campaigns.aiDraft.researchInput')}: {t('campaigns.aiDraft.versionValue', { version: latestResearch.version })}</p> : null}</div>
      <button data-testid="ai-draft-button" type="button" disabled={!latestResearch || !confirmedResearchId || !isAllowed || mutation.isPending} onClick={() => mutation.mutate({ requestId: crypto.randomUUID() })} className="shrink-0 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">{mutation.isPending ? t('campaigns.aiDraft.generating') : latestMessage ? t('campaigns.aiDraft.generateNew') : t('campaigns.aiDraft.generate')}</button>
    </div>
    {latestResearch ? <label className="mt-4 flex min-w-0 items-start gap-2 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"><input data-testid="ai-draft-confirmation" type="checkbox" checked={confirmedResearchId === latestResearch.id} onChange={(event) => setConfirmedResearchId(event.target.checked ? latestResearch.id : null)} className="mt-0.5" /><span>{t('campaigns.aiDraft.confirmation', { version: latestResearch.version })}</span></label> : <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t('campaigns.aiDraft.researchRequiredHint')}</p>}
    {!isAllowed && latestResearch ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t('campaigns.aiDraft.unavailableHint')}</p> : null}
    {metadata ? <dl className="mt-4 grid min-w-0 gap-2 text-sm sm:grid-cols-2"><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiDraft.messageVersion')}</dt><dd className="font-medium">{metadata.message_version || '—'}</dd></div><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiDraft.researchVersion')}</dt><dd className="font-medium">{metadata.research_version || latestResearch?.version || '—'}</dd></div><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiDraft.model')}</dt><dd className="break-words font-medium">{metadata.model}</dd></div><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiDraft.tokens')}</dt><dd className="font-medium">{metadata.usage.total_tokens}</dd></div><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiDraft.duration')}</dt><dd className="font-medium">{metadata.duration_ms} ms</dd></div><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiDraft.cost')}</dt><dd className="font-medium">{t('campaigns.aiDraft.costNotConfigured')}</dd></div><div className="min-w-0 sm:col-span-2"><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiDraft.identifier')}</dt><dd className="truncate font-mono text-xs" title={metadata.request_id}>{metadata.request_id.slice(0, 8)}</dd></div></dl> : null}
    {status === 'completed' ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t('campaigns.aiDraft.reviewRequired')}</p> : null}
    {status === 'failed' ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">{t('campaigns.aiDraft.failedHint')}</p> : null}
  </section>
}

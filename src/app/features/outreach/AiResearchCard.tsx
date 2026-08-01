import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { campaignQueryKeys, generateAiResearch, getLatestAiResearchJob } from '../../../features/campaigns/campaignsApi'
import type { AiResearchJob, CampaignMemberStatus } from '../../../features/campaigns/types'
import { useI18n } from '../../../i18n/i18n'

function isUsableWebsite(value: string | null | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && hostname !== 'localhost' && !hostname.endsWith('.local') && !['example.com', 'example.org', 'example.net'].includes(hostname)
  } catch { return false }
}

function jobFromResult(result: Awaited<ReturnType<typeof generateAiResearch>>): AiResearchJob {
  return { id: result.job_id, generation_status: 'completed', model_name: result.model, total_tokens: result.usage.total_tokens, duration_ms: result.duration_ms, request_id: result.job_id, created_at: new Date().toISOString(), error_code: null, output_payload: null }
}

export function AiResearchCard({ memberId, campaignId, leadId, website, memberStatus, researchVersion = null }: { memberId: string; campaignId: string; leadId: string; website: string | null; memberStatus: CampaignMemberStatus; researchVersion?: number | null }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const usableWebsite = isUsableWebsite(website)
  const hostname = usableWebsite ? new URL(website!).hostname.replace(/^www\./, '') : null
  const researchQuery = useQuery({ queryKey: campaignQueryKeys.aiResearch(memberId), queryFn: () => getLatestAiResearchJob(memberId) })
  const mutation = useMutation({
    mutationFn: () => generateAiResearch(memberId, crypto.randomUUID()),
    onSuccess: (result) => {
      queryClient.setQueryData(campaignQueryKeys.aiResearch(memberId), jobFromResult(result))
      queryClient.invalidateQueries({ queryKey: campaignQueryKeys.aiResearch(memberId) })
      queryClient.invalidateQueries({ queryKey: campaignQueryKeys.workspace(campaignId, memberId) })
      queryClient.invalidateQueries({ queryKey: campaignQueryKeys.detail(campaignId) })
      queryClient.invalidateQueries({ queryKey: campaignQueryKeys.members(campaignId) })
      queryClient.invalidateQueries({ queryKey: campaignQueryKeys.leadSummary(leadId) })
    },
  })
  const job = researchQuery.data
  const output = job?.output_payload && typeof job.output_payload === 'object' && !Array.isArray(job.output_payload) ? job.output_payload as Record<string, unknown> : null
  const confidence = typeof output?.confidence === 'number' ? output.confidence : null
  const sourceCount = Array.isArray(output?.evidence) ? output.evidence.length : null
  const status = mutation.isPending ? 'researching' : mutation.isError || job?.generation_status === 'failed' ? 'failed' : job?.generation_status === 'completed' ? 'completed' : usableWebsite ? 'ready' : 'websiteRequired'
  const laterStatus = !['queued', 'researching', 'research_ready'].includes(memberStatus)
  return <section data-testid="ai-research" className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-zinc-900 dark:text-zinc-100">{t('campaigns.aiResearch.title')}</h2><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('campaigns.aiResearch.status')}: {t('campaigns.aiResearch.' + status)}</p><p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t('campaigns.aiResearch.explanation')}</p>{hostname ? <p className="mt-1 text-xs text-zinc-500">{t('campaigns.aiResearch.domain')}: {hostname}</p> : <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t('campaigns.aiResearch.websiteRequiredHint')}</p>}</div><button data-testid="ai-research-button" type="button" disabled={!usableWebsite || mutation.isPending} onClick={() => mutation.mutate()} className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">{mutation.isPending ? t('campaigns.aiResearch.researching') : job?.generation_status === 'completed' ? t('campaigns.aiResearch.generateNew') : t('campaigns.aiResearch.generate')}</button></div>
    {laterStatus ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t('campaigns.aiResearch.laterStatusWarning')}</p> : null}
    {status === 'completed' && job ? <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiResearch.version')}</dt><dd className="font-medium">{t('campaigns.aiResearch.versionValue', { version: researchVersion ?? '—' })}</dd></div><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiResearch.model')}</dt><dd className="font-medium">{job.model_name}</dd></div><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiResearch.tokens')}</dt><dd className="font-medium">{job.total_tokens ?? 0}</dd></div><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiResearch.duration')}</dt><dd className="font-medium">{job.duration_ms ?? 0} ms</dd></div><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiResearch.confidence')}</dt><dd className="font-medium">{confidence ?? '—'}</dd></div><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiResearch.sources')}</dt><dd className="font-medium">{sourceCount ?? '—'}</dd></div><div className="min-w-0 sm:col-span-2"><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiResearch.identifier')}</dt><dd className="truncate font-mono text-xs" title={job.request_id ?? job.id}>{(job.request_id ?? job.id).slice(0, 8)}</dd></div></dl> : null}
    {status === 'completed' ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t('campaigns.aiResearch.reviewRequired')}</p> : null}
    {status === 'failed' ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">{t('campaigns.aiResearch.failedHint')}</p> : null}
  </section>
}

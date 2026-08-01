import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { campaignQueryKeys, getLatestAiRuntimeProbe, testAiRuntimeConnection } from '../../../features/campaigns/campaignsApi'
import type { AiRuntimeProbe } from '../../../features/campaigns/types'
import { useI18n } from '../../../i18n/i18n'

function probeFromResult(result: Awaited<ReturnType<typeof testAiRuntimeConnection>>): AiRuntimeProbe {
  return { id: result.job_id, generation_status: 'completed', model_name: result.model, total_tokens: result.usage.total_tokens, duration_ms: result.duration_ms, estimated_cost_usd: result.cost.estimated_usd, request_id: result.job_id, created_at: new Date().toISOString() }
}

export function AiRuntimeProbeCard({ memberId }: { memberId: string }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const probeQuery = useQuery({ queryKey: campaignQueryKeys.aiRuntimeProbe(memberId), queryFn: () => getLatestAiRuntimeProbe(memberId) })
  const mutation = useMutation({
    mutationFn: () => testAiRuntimeConnection(memberId, crypto.randomUUID()),
    onSuccess: (result) => {
      queryClient.setQueryData(campaignQueryKeys.aiRuntimeProbe(memberId), probeFromResult(result))
    },
  })
  const probe = probeQuery.data
  const status = mutation.isPending ? 'testing' : mutation.isError || probe?.generation_status === 'failed' ? 'failed' : probe?.generation_status === 'completed' ? 'connected' : 'notTested'

  return <section data-testid="ai-runtime-probe" className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-zinc-900 dark:text-zinc-100">{t('campaigns.aiRuntime.title')}</h2><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('campaigns.aiRuntime.status')}: {t('campaigns.aiRuntime.' + status)}</p></div><button data-testid="ai-runtime-probe-button" type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()} className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">{mutation.isPending ? t('campaigns.aiRuntime.testing') : t('campaigns.aiRuntime.test')}</button></div>
    {status === 'connected' && probe ? <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiRuntime.model')}</dt><dd className="font-medium text-zinc-800 dark:text-zinc-100">{probe.model_name}</dd></div><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiRuntime.tokens')}</dt><dd className="font-medium text-zinc-800 dark:text-zinc-100">{probe.total_tokens ?? 0}</dd></div><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiRuntime.duration')}</dt><dd className="font-medium text-zinc-800 dark:text-zinc-100">{probe.duration_ms ?? 0} ms</dd></div><div><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiRuntime.cost')}</dt><dd className="font-medium text-zinc-800 dark:text-zinc-100">{t('campaigns.aiRuntime.costNotConfigured')}</dd></div><div className="sm:col-span-2"><dt className="text-zinc-500 dark:text-zinc-400">{t('campaigns.aiRuntime.identifier')}</dt><dd className="font-mono text-xs text-zinc-700 dark:text-zinc-200">{(probe.request_id ?? probe.id).slice(0, 8)}</dd></div></dl> : null}
    {status === 'failed' ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">{t('campaigns.aiRuntime.failedHint')}</p> : null}
  </section>
}

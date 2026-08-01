import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { approveMessage, campaignQueryKeys, getCampaignMemberContext, listCampaignMembers, saveMessage, saveResearch, skipCampaignMember } from '../../../features/campaigns/campaignsApi'
import { nextReviewMemberId } from '../../../features/campaigns/workflow'
import type { ResearchEvidence } from '../../../features/campaigns/types'
import { useI18n } from '../../../i18n/i18n'
import { featureFlags } from '../../../features/featureFlags/featureFlags'
import { AiRuntimeProbeCard } from '../../features/outreach/AiRuntimeProbeCard'

export function CampaignWorkspacePage() {
  const { campaignId, memberId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const contextQuery = useQuery({ queryKey: campaignQueryKeys.workspace(campaignId!, memberId!), queryFn: () => getCampaignMemberContext(campaignId!, memberId!), enabled: Boolean(campaignId && memberId) })
  const membersQuery = useQuery({ queryKey: campaignQueryKeys.members(campaignId!), queryFn: () => listCampaignMembers(campaignId!), enabled: Boolean(campaignId) })
  const [observedOpportunity, setObservedOpportunity] = useState('')
  const [recommendedOffer, setRecommendedOffer] = useState('')
  const [recommendedCase, setRecommendedCase] = useState('')
  const [confidence, setConfidence] = useState('')
  const [warnings, setWarnings] = useState('')
  const [evidence, setEvidence] = useState<ResearchEvidence[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const latestResearch = contextQuery.data?.research[0] ?? null
  const latestMessage = contextQuery.data?.messages[0] ?? null

  useEffect(() => {
    if (!latestResearch) return
    // The workspace intentionally resets the saved-research form when the URL member changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setObservedOpportunity(latestResearch.observed_opportunity ?? '')
    setRecommendedOffer(latestResearch.recommended_offer ?? '')
    setRecommendedCase(latestResearch.recommended_case ?? '')
    setConfidence(latestResearch.confidence?.toString() ?? '')
    setWarnings(latestResearch.warnings.join('\n'))
    setEvidence(latestResearch.evidence)
  }, [latestResearch])
  useEffect(() => {
    if (!latestMessage) return
    // The workspace intentionally resets the saved-message form when the URL member changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubject(latestMessage.subject ?? '')
    setBody(latestMessage.body)
  }, [latestMessage])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: campaignQueryKeys.all })
    queryClient.invalidateQueries({ queryKey: campaignQueryKeys.workspace(campaignId!, memberId!) })
  }
  const researchMutation = useMutation({
    mutationFn: () => saveResearch(memberId!, { observed_opportunity: observedOpportunity, recommended_offer: recommendedOffer, recommended_case: recommendedCase, evidence: evidence.filter((item) => item.url.trim() || item.claim.trim()), confidence: confidence === '' ? null : Number(confidence), warnings: warnings.split('\n').map((item) => item.trim()).filter(Boolean) }),
    onSuccess: invalidate,
    onError: (error) => setActionError(error.message),
  })
  const messageMutation = useMutation({
    mutationFn: (submission: 'draft' | 'needs_review') => saveMessage(memberId!, { subject, body, channel: contextQuery.data!.campaign.default_channel, language: contextQuery.data!.campaign.default_language, research_snapshot_id: latestResearch?.id ?? null }, submission),
    onSuccess: invalidate,
    onError: (error) => setActionError(error.message),
  })
  const moveNext = async () => {
    const members = await listCampaignMembers(campaignId!)
    const next = nextReviewMemberId(members, memberId)
    navigate(next ? '/campaigns/' + campaignId + '/review/' + next : '/campaigns/' + campaignId)
  }
  const approveMutation = useMutation({ mutationFn: () => approveMessage(latestMessage!.id), onSuccess: async () => { invalidate(); await moveNext() }, onError: (error) => setActionError(error.message) })
  const skipMutation = useMutation({ mutationFn: (reason?: string) => skipCampaignMember(memberId!, reason), onSuccess: async () => { invalidate(); await moveNext() }, onError: (error) => setActionError(error.message) })

  const queuePosition = useMemo(() => {
    const members = membersQuery.data ?? []
    const index = members.findIndex((item) => item.id === memberId)
    return { current: index >= 0 ? index + 1 : 1, total: members.length }
  }, [membersQuery.data, memberId])

  if (contextQuery.isLoading) return <p className="text-sm text-zinc-500">{t('campaigns.loading')}</p>
  if (contextQuery.isError || !contextQuery.data) return <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{t('campaigns.memberNotFound')}</p>
  const { campaign, member, lead, research } = contextQuery.data

  return (
    <section data-testid="campaign-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-zinc-500">{campaign.name} · {t('campaigns.contactOf', queuePosition)}</p><h1 className="mt-1 text-2xl font-semibold text-zinc-900">{lead?.company_name || t('campaigns.memberUnavailable')}</h1></div><Link to={'/campaigns/' + campaign.id} className="text-sm font-medium text-zinc-600">{t('campaigns.back')}</Link></div>
      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(240px,0.35fr)_minmax(0,0.65fr)]">
        <aside className="space-y-4 rounded-3xl border border-zinc-200 bg-zinc-50 p-5"><div><p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('campaigns.workspace.leadContext')}</p><p className="mt-2 font-semibold text-zinc-900">{lead?.contact_name || t('campaigns.none')}</p><p className="mt-1 text-sm text-zinc-600">{lead?.email || lead?.phone || lead?.website || t('campaigns.noContact')}</p></div><div><p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('campaigns.workspace.campaignContext')}</p><p className="mt-2 text-sm text-zinc-700">{campaign.offer_summary || t('campaigns.none')}</p><p className="mt-1 text-sm text-zinc-600">{campaign.tone || ''}</p></div><div><p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('campaigns.workspace.status')}</p><p className="mt-2 inline-flex rounded-full bg-white px-2 py-1 text-xs">{t('campaigns.memberStatus.' + member.status)}</p></div></aside>
        <div className="space-y-5"><form className="rounded-3xl border border-zinc-200 bg-white p-5" onSubmit={(event) => { event.preventDefault(); setActionError(null); researchMutation.mutate() }}><div className="flex items-center justify-between"><div><h2 className="font-semibold text-zinc-900">{t('campaigns.research.title')}</h2><p className="mt-1 text-sm text-zinc-500">{latestResearch ? t('campaigns.research.latest', { version: latestResearch.version }) : t('campaigns.research.empty')}</p></div>{research.length > 1 ? <span className="text-xs text-zinc-500">{t('campaigns.research.versions', { count: research.length })}</span> : null}</div><div className="mt-4 grid gap-3"><Field label={t('campaigns.research.opportunity')} value={observedOpportunity} onChange={setObservedOpportunity} multiline /><Field label={t('campaigns.research.offer')} value={recommendedOffer} onChange={setRecommendedOffer} multiline /><Field label={t('campaigns.research.case')} value={recommendedCase} onChange={setRecommendedCase} multiline /><label className="space-y-1"><span className="text-sm font-medium">{t('campaigns.research.confidence')}</span><input type="number" min="0" max="1" step="0.1" value={confidence} onChange={(event) => setConfidence(event.target.value)} className="w-full rounded-xl border border-zinc-200 px-3 py-2" /></label><Field label={t('campaigns.research.warnings')} value={warnings} onChange={setWarnings} multiline /></div><div className="mt-4"><p className="text-sm font-medium">{t('campaigns.research.evidence')}</p><div className="mt-2 space-y-2">{evidence.map((item, index) => <div key={index} className="grid gap-2 rounded-xl bg-zinc-50 p-3 sm:grid-cols-[1fr_1fr_auto]"><input aria-label={t('campaigns.research.evidenceUrl')} value={item.url} onChange={(event) => setEvidence((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, url: event.target.value } : row))} placeholder={t('campaigns.research.evidenceUrl')} className="rounded-lg border border-zinc-200 px-2 py-2 text-sm" /><input aria-label={t('campaigns.research.evidenceClaim')} value={item.claim} onChange={(event) => setEvidence((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, claim: event.target.value } : row))} placeholder={t('campaigns.research.evidenceClaim')} className="rounded-lg border border-zinc-200 px-2 py-2 text-sm" /><button type="button" onClick={() => setEvidence((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-sm text-zinc-600">{t('campaigns.remove')}</button></div>)}</div><button type="button" onClick={() => setEvidence((current) => [...current, { url: '', claim: '' }])} className="mt-3 rounded-xl border border-zinc-200 px-3 py-2 text-sm">{t('campaigns.research.addEvidence')}</button></div><button data-testid="research-save" disabled={researchMutation.isPending} className="mt-5 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{researchMutation.isPending ? t('campaigns.saving') : t('campaigns.research.save')}</button></form>
          <form className="rounded-3xl border border-zinc-200 bg-white p-5" onSubmit={(event) => { event.preventDefault(); setActionError(null); messageMutation.mutate('draft') }}><div><h2 className="font-semibold text-zinc-900">{t('campaigns.message.title')}</h2><p className="mt-1 text-sm text-zinc-500">{latestMessage ? t('campaigns.message.latest', { version: latestMessage.version }) : t('campaigns.message.empty')}</p></div><div className="mt-4 grid gap-3"><Field label={t('campaigns.message.subject')} value={subject} onChange={setSubject} /><Field label={t('campaigns.message.body')} value={body} onChange={setBody} multiline /></div><div className="mt-5 flex flex-wrap gap-2"><button data-testid="message-save-draft" disabled={!body.trim() || messageMutation.isPending} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 disabled:opacity-50">{t('campaigns.message.saveDraft')}</button><button data-testid="message-submit-review" type="button" disabled={!body.trim() || messageMutation.isPending} onClick={() => { setActionError(null); messageMutation.mutate('needs_review') }} className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{t('campaigns.message.submit')}</button>{latestMessage?.status === 'needs_review' ? <button data-testid="message-approve-next" type="button" disabled={approveMutation.isPending} onClick={() => { setActionError(null); approveMutation.mutate() }} className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{t('campaigns.message.approveNext')}</button> : null}</div></form>
          {actionError ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{actionError}</p> : null}
        </div>
      </div>
      <div className="mt-5 flex justify-between gap-3"><button data-testid="member-skip" type="button" disabled={skipMutation.isPending} onClick={() => { const reason = window.prompt(t('campaigns.skipPrompt')); if (reason !== null) skipMutation.mutate(reason) }} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-700">{t('campaigns.skip')}</button><button data-testid="workspace-next" type="button" onClick={() => moveNext()} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-700">{t('campaigns.next')}</button></div>
    {featureFlags.outreach_ops_enabled && featureFlags.ai_runtime_enabled ? <div className="mt-5"><AiRuntimeProbeCard memberId={member.id} /></div> : null}
    </section>
  )
}

function Field({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return <label className="space-y-1"><span className="text-sm font-medium">{label}</span>{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} className="min-h-24 w-full rounded-xl border border-zinc-200 px-3 py-2.5" /> : <input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5" />}</label>
}

import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { addCampaignMembers, campaignQueryKeys, createCampaign, getCampaign, listActiveSuppressions, listCampaignMembers, updateCampaign } from '../../../features/campaigns/campaignsApi'
import type { CampaignInput, OutreachChannel, OutreachLanguage } from '../../../features/campaigns/types'
import { campaignPickerEligibility, campaignLeadsWizardStep, campaignWizardSteps, canSubmitCampaignWizard, nextCampaignWizardStep, previousCampaignWizardStep, type CampaignWizardStep } from '../../../features/campaigns/workflow'
import { campaignDraftKey, clearCampaignDraft, readCampaignDraft, writeCampaignDraft } from '../../../features/campaigns/campaignDraft'
import { leadsQueryKeys, listLeads } from '../../../features/leads/leadsApi'
import { useI18n } from '../../../i18n/i18n'

const channels: OutreachChannel[] = ['email', 'linkedin', 'ig', 'other']
const languages: OutreachLanguage[] = ['en', 'uk', 'es', 'ru']

export function CampaignEditorPage() {
  const { campaignId } = useParams()
  const editing = Boolean(campaignId)
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const draftKey = campaignDraftKey(campaignId)
  const restoredDraft = useMemo(() => readCampaignDraft(sessionStorage, draftKey), [draftKey])
  const campaignQuery = useQuery({ queryKey: campaignQueryKeys.detail(campaignId ?? 'new'), queryFn: () => getCampaign(campaignId!), enabled: editing })
  const membersQuery = useQuery({ queryKey: campaignQueryKeys.members(campaignId ?? 'new'), queryFn: () => listCampaignMembers(campaignId!), enabled: editing })
  const leadsQuery = useQuery({ queryKey: leadsQueryKeys.list({ scope: 'campaign-picker' }), queryFn: () => listLeads() })
  const suppressionsQuery = useQuery({ queryKey: campaignQueryKeys.suppressions(), queryFn: listActiveSuppressions })
  const [step, setStep] = useState<CampaignWizardStep>(() => searchParams.get('step') === 'leads' ? campaignLeadsWizardStep : restoredDraft?.step ?? 1)
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>(() => restoredDraft?.selectedLeadIds ?? [])
  const [form, setForm] = useState<CampaignInput>(() => restoredDraft?.form ?? { name: '', description: '', target_segment: '', offer_summary: '', default_channel: 'email', default_language: 'en', tone: '', status: 'draft' })
  const [draftReady, setDraftReady] = useState(() => !editing || Boolean(restoredDraft))

  useEffect(() => {
    if (!campaignQuery.data || restoredDraft) return
    // The edit form intentionally resets when its route record finishes loading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      name: campaignQuery.data.name, description: campaignQuery.data.description ?? '', target_segment: campaignQuery.data.target_segment ?? '',
      offer_summary: campaignQuery.data.offer_summary ?? '', default_channel: campaignQuery.data.default_channel,
      default_language: campaignQuery.data.default_language, tone: campaignQuery.data.tone ?? '', status: campaignQuery.data.status,
    })
    setDraftReady(true)
  }, [campaignQuery.data, restoredDraft])

  useEffect(() => {
    if (!draftReady) return
    writeCampaignDraft(sessionStorage, draftKey, { version: 1, form, step, selectedLeadIds })
  }, [draftKey, draftReady, form, selectedLeadIds, step])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error(t('campaigns.validation.name'))
      const campaign = editing ? await updateCampaign(campaignId!, form) : await createCampaign(form)
      const results = await addCampaignMembers(campaign.id, selectedLeadIds.filter((leadId) => !existingMemberLeadIds.has(leadId)))
      return { campaign, results }
    },
    onSuccess: ({ campaign, results }) => {
      clearCampaignDraft(sessionStorage, draftKey)
      queryClient.invalidateQueries({ queryKey: campaignQueryKeys.all })
      const ineligible = results.filter((item) => item.outcome !== 'eligible')
      navigate('/campaigns/' + campaign.id, { state: { eligibility: ineligible } })
    },
  })

  const activeLeads = (leadsQuery.data ?? []).filter((lead) => lead.status === 'active')
  const existingMemberLeadIds = new Set((membersQuery.data ?? []).map((member) => member.lead_id))
  const suppressions = suppressionsQuery.data ?? []
  const setField = <K extends keyof CampaignInput>(key: K, value: CampaignInput[K]) => setForm((current) => ({ ...current, [key]: value }))
  const persistDraft = () => writeCampaignDraft(sessionStorage, draftKey, { version: 1, form, step, selectedLeadIds })
  const handleNext = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setStep((current) => nextCampaignWizardStep(current))
  }
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmitCampaignWizard(step) || saveMutation.isPending) return
    saveMutation.mutate()
  }

  return (
    <section data-testid="campaign-editor">
      <div className="flex items-center justify-between gap-4">
        <div><h1 className="text-2xl font-semibold text-zinc-900">{editing ? t('campaigns.edit') : t('campaigns.create')}</h1><p className="mt-2 text-sm text-zinc-600">{t('campaigns.wizard.subtitle')}</p></div>
        <Link to={editing ? '/campaigns/' + campaignId : '/campaigns'} className="text-sm font-medium text-zinc-600 hover:text-zinc-950">{t('campaigns.back')}</Link>
      </div>
      <ol className="mt-6 grid grid-cols-4 gap-2 text-xs text-zinc-500">{campaignWizardSteps.map((item) => <li key={item} className={'rounded-lg px-2 py-2 text-center ' + (step === item ? 'bg-zinc-900 text-white' : 'bg-zinc-100')}>{t('campaigns.wizard.step' + item)}</li>)}</ol>
      <form className="mt-6 rounded-3xl border border-zinc-200 bg-white p-5" onSubmit={handleSubmit}>
        {step === 1 ? <div className="grid gap-4"><label className="space-y-1"><span className="text-sm font-medium">{t('campaigns.field.name')}</span><input required value={form.name} onChange={(event) => setField('name', event.target.value)} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5" /></label><label className="space-y-1"><span className="text-sm font-medium">{t('campaigns.field.description')}</span><textarea value={form.description} onChange={(event) => setField('description', event.target.value)} className="min-h-28 w-full rounded-xl border border-zinc-200 px-3 py-2.5" /></label></div> : null}
        {step === 2 ? <div className="grid gap-4"><label className="space-y-1"><span className="text-sm font-medium">{t('campaigns.field.target')}</span><input value={form.target_segment} onChange={(event) => setField('target_segment', event.target.value)} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1"><span className="text-sm font-medium">{t('campaigns.field.channel')}</span><select value={form.default_channel} onChange={(event) => setField('default_channel', event.target.value as OutreachChannel)} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5">{channels.map((item) => <option key={item} value={item}>{t('campaigns.channel.' + item)}</option>)}</select></label><label className="space-y-1"><span className="text-sm font-medium">{t('campaigns.field.language')}</span><select value={form.default_language} onChange={(event) => setField('default_language', event.target.value as OutreachLanguage)} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5">{languages.map((item) => <option key={item} value={item}>{t('lang.' + item)}</option>)}</select></label></div></div> : null}
        {step === 3 ? <div className="grid gap-4"><label className="space-y-1"><span className="text-sm font-medium">{t('campaigns.field.offer')}</span><textarea value={form.offer_summary} onChange={(event) => setField('offer_summary', event.target.value)} className="min-h-28 w-full rounded-xl border border-zinc-200 px-3 py-2.5" /></label><label className="space-y-1"><span className="text-sm font-medium">{t('campaigns.field.tone')}</span><input value={form.tone} onChange={(event) => setField('tone', event.target.value)} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5" /></label></div> : null}
        {step === campaignLeadsWizardStep ? <div data-testid="campaign-wizard-leads-step"><p className="text-sm text-zinc-600">{editing ? t('campaigns.editHint') : t('campaigns.addLeadsHint')}</p>{leadsQuery.isLoading || suppressionsQuery.isLoading ? <p className="mt-4 text-sm text-zinc-500">{t('campaigns.loading')}</p> : null}{!leadsQuery.isLoading && activeLeads.length === 0 ? <p className="mt-4 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600">{t('campaigns.noActiveLeads')}</p> : null}<div className="mt-4 max-h-80 space-y-2 overflow-y-auto">{activeLeads.map((lead) => {
          const alreadyAdded = existingMemberLeadIds.has(lead.id)
          const checked = alreadyAdded || selectedLeadIds.includes(lead.id)
          const eligibility = campaignPickerEligibility(lead, existingMemberLeadIds, suppressions)
          const selectable = eligibility.outcome === 'eligible'
          const returnTo = `${location.pathname}?step=leads`
          return <div key={lead.id} className={'flex gap-3 rounded-xl border border-zinc-200 p-3 ' + (!selectable ? 'bg-zinc-50' : '')}><input aria-label={lead.company_name} type="checkbox" disabled={!selectable} checked={checked} onChange={(event) => setSelectedLeadIds((current) => event.target.checked ? [...new Set([...current, lead.id])] : current.filter((id) => id !== lead.id))} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{lead.company_name}</strong><span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">{t('campaigns.eligibility.' + eligibility.outcome)}</span></div><span className="mt-1 block text-xs text-zinc-500">{lead.email || lead.phone || lead.website || t('campaigns.noContact')}</span>{eligibility.reasonKey ? <span className="mt-1 block text-xs text-amber-700">{t(eligibility.reasonKey)}</span> : null}{eligibility.outcome === 'needs_information' ? <Link to={`/leads/${lead.id}/edit?returnTo=${encodeURIComponent(returnTo)}`} onClick={persistDraft} className="mt-2 inline-flex rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700">{t('campaigns.editLead')}</Link> : null}</div></div>
        })}</div></div> : null}
        {saveMutation.error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{saveMutation.error.message}</p> : null}
        <div className="mt-6 flex justify-between gap-3">{step > 1 ? <button type="button" onClick={() => setStep((current) => previousCampaignWizardStep(current))} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm">{t('campaigns.previous')}</button> : <span />}{!canSubmitCampaignWizard(step) ? <button type="button" onClick={handleNext} data-testid="campaign-wizard-next" className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white">{t('campaigns.next')}</button> : <button type="submit" data-testid="campaign-add-leads" disabled={saveMutation.isPending} className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saveMutation.isPending ? t('campaigns.saving') : editing ? t('campaigns.save') : t('campaigns.create')}</button>}</div>
      </form>
    </section>
  )
}

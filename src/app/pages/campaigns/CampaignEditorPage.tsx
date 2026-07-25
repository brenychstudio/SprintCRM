import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { addCampaignMembers, campaignQueryKeys, createCampaign, getCampaign, updateCampaign } from '../../../features/campaigns/campaignsApi'
import type { CampaignInput, OutreachChannel, OutreachLanguage } from '../../../features/campaigns/types'
import { listLeads } from '../../../features/leads/leadsApi'
import { useI18n } from '../../../i18n/i18n'

const channels: OutreachChannel[] = ['email', 'linkedin', 'ig', 'other']
const languages: OutreachLanguage[] = ['en', 'uk', 'es', 'ru']

export function CampaignEditorPage() {
  const { campaignId } = useParams()
  const editing = Boolean(campaignId)
  const navigate = useNavigate()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const campaignQuery = useQuery({ queryKey: campaignQueryKeys.detail(campaignId ?? 'new'), queryFn: () => getCampaign(campaignId!), enabled: editing })
  const leadsQuery = useQuery({ queryKey: ['leads', 'campaign-picker'], queryFn: () => listLeads() })
  const [step, setStep] = useState(1)
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([])
  const [form, setForm] = useState<CampaignInput>({ name: '', description: '', target_segment: '', offer_summary: '', default_channel: 'email', default_language: 'en', tone: '', status: 'draft' })

  useEffect(() => {
    if (!campaignQuery.data) return
    // The edit form intentionally resets when its route record finishes loading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      name: campaignQuery.data.name, description: campaignQuery.data.description ?? '', target_segment: campaignQuery.data.target_segment ?? '',
      offer_summary: campaignQuery.data.offer_summary ?? '', default_channel: campaignQuery.data.default_channel,
      default_language: campaignQuery.data.default_language, tone: campaignQuery.data.tone ?? '', status: campaignQuery.data.status,
    })
  }, [campaignQuery.data])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error(t('campaigns.validation.name'))
      const campaign = editing ? await updateCampaign(campaignId!, form) : await createCampaign(form)
      const results = !editing ? await addCampaignMembers(campaign.id, selectedLeadIds) : []
      return { campaign, results }
    },
    onSuccess: ({ campaign, results }) => {
      queryClient.invalidateQueries({ queryKey: campaignQueryKeys.all })
      const ineligible = results.filter((item) => item.outcome !== 'eligible')
      navigate('/campaigns/' + campaign.id, { state: { eligibility: ineligible } })
    },
  })

  const activeLeads = (leadsQuery.data ?? []).filter((lead) => lead.status === 'active')
  const setField = <K extends keyof CampaignInput>(key: K, value: CampaignInput[K]) => setForm((current) => ({ ...current, [key]: value }))

  return (
    <section data-testid="campaign-editor">
      <div className="flex items-center justify-between gap-4">
        <div><h1 className="text-2xl font-semibold text-zinc-900">{editing ? t('campaigns.edit') : t('campaigns.create')}</h1><p className="mt-2 text-sm text-zinc-600">{t('campaigns.wizard.subtitle')}</p></div>
        <Link to={editing ? '/campaigns/' + campaignId : '/campaigns'} className="text-sm font-medium text-zinc-600 hover:text-zinc-950">{t('campaigns.back')}</Link>
      </div>
      <ol className="mt-6 grid grid-cols-4 gap-2 text-xs text-zinc-500">{[1, 2, 3, 4].map((item) => <li key={item} className={'rounded-lg px-2 py-2 text-center ' + (step === item ? 'bg-zinc-900 text-white' : 'bg-zinc-100')}>{t('campaigns.wizard.step' + item)}</li>)}</ol>
      <form className="mt-6 rounded-3xl border border-zinc-200 bg-white p-5" onSubmit={(event) => { event.preventDefault(); saveMutation.mutate() }}>
        {step === 1 ? <div className="grid gap-4"><label className="space-y-1"><span className="text-sm font-medium">{t('campaigns.field.name')}</span><input required value={form.name} onChange={(event) => setField('name', event.target.value)} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5" /></label><label className="space-y-1"><span className="text-sm font-medium">{t('campaigns.field.description')}</span><textarea value={form.description} onChange={(event) => setField('description', event.target.value)} className="min-h-28 w-full rounded-xl border border-zinc-200 px-3 py-2.5" /></label></div> : null}
        {step === 2 ? <div className="grid gap-4"><label className="space-y-1"><span className="text-sm font-medium">{t('campaigns.field.target')}</span><input value={form.target_segment} onChange={(event) => setField('target_segment', event.target.value)} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1"><span className="text-sm font-medium">{t('campaigns.field.channel')}</span><select value={form.default_channel} onChange={(event) => setField('default_channel', event.target.value as OutreachChannel)} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5">{channels.map((item) => <option key={item} value={item}>{t('campaigns.channel.' + item)}</option>)}</select></label><label className="space-y-1"><span className="text-sm font-medium">{t('campaigns.field.language')}</span><select value={form.default_language} onChange={(event) => setField('default_language', event.target.value as OutreachLanguage)} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5">{languages.map((item) => <option key={item} value={item}>{t('lang.' + item)}</option>)}</select></label></div></div> : null}
        {step === 3 ? <div className="grid gap-4"><label className="space-y-1"><span className="text-sm font-medium">{t('campaigns.field.offer')}</span><textarea value={form.offer_summary} onChange={(event) => setField('offer_summary', event.target.value)} className="min-h-28 w-full rounded-xl border border-zinc-200 px-3 py-2.5" /></label><label className="space-y-1"><span className="text-sm font-medium">{t('campaigns.field.tone')}</span><input value={form.tone} onChange={(event) => setField('tone', event.target.value)} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5" /></label></div> : null}
        {step === 4 && !editing ? <div><p className="text-sm text-zinc-600">{t('campaigns.addLeadsHint')}</p><div className="mt-4 max-h-80 space-y-2 overflow-y-auto">{activeLeads.map((lead) => <label key={lead.id} className="flex cursor-pointer gap-3 rounded-xl border border-zinc-200 p-3"><input type="checkbox" checked={selectedLeadIds.includes(lead.id)} onChange={(event) => setSelectedLeadIds((current) => event.target.checked ? [...current, lead.id] : current.filter((id) => id !== lead.id))} /><span><strong className="block text-sm">{lead.company_name}</strong><span className="text-xs text-zinc-500">{lead.email || lead.phone || lead.website || t('campaigns.noContact')}</span></span></label>)}</div></div> : null}
        {step === 4 && editing ? <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-600">{t('campaigns.editHint')}</div> : null}
        {saveMutation.error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{saveMutation.error.message}</p> : null}
        <div className="mt-6 flex justify-between gap-3">{step > 1 ? <button type="button" onClick={() => setStep((current) => current - 1)} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm">{t('campaigns.previous')}</button> : <span />}{step < 4 ? <button type="button" onClick={() => setStep((current) => current + 1)} className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white">{t('campaigns.next')}</button> : <button data-testid="campaign-add-leads" disabled={saveMutation.isPending} className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saveMutation.isPending ? t('campaigns.saving') : editing ? t('campaigns.save') : t('campaigns.create')}</button>}</div>
      </form>
    </section>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useBeforeUnload, useBlocker, useNavigate } from 'react-router-dom'
import { campaignQueryKeys } from '../../../features/campaigns/campaignsApi'
import {
  changedLeadDetailFields,
  emptyLeadDetails,
  hasEnteredContactChannel,
  leadDetailsFromLead,
  normalizeLeadDetails,
  validateLeadDetails,
  type LeadDetailsValidationErrors,
  type LeadDetailsValues,
  type LeadDuplicateMatch,
} from '../../../features/leads/leadDetails'
import { leadDrawerTarget, safeLeadReturnTarget } from '../../../features/leads/leadNavigation'
import {
  createLeadFromDetails,
  findLeadDuplicates,
  LeadUniqueViolationError,
  leadsQueryKeys,
  updateLeadDetails,
} from '../../../features/leads/leadsApi'
import type { Lead, OutreachChannel, OutreachLanguage } from '../../../features/leads/types'
import { useI18n } from '../../../i18n/i18n'

type Props = {
  mode: 'create' | 'edit'
  lead?: Lead
  returnTo?: string | null
}

type DuplicatePrompt = {
  kind: 'exact' | 'company'
  matches: LeadDuplicateMatch[]
}

const channels: OutreachChannel[] = ['email', 'linkedin', 'ig', 'other']
const languages: OutreachLanguage[] = ['en', 'uk', 'es', 'ru']

export function LeadDetailsForm({ mode, lead, returnTo }: Props) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const initialValues = useMemo(() => lead ? leadDetailsFromLead(lead) : emptyLeadDetails(), [lead])
  const [values, setValues] = useState<LeadDetailsValues>(initialValues)
  const [errors, setErrors] = useState<LeadDetailsValidationErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicatePrompt | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const saveLockRef = useRef(false)
  const saveCompletedRef = useRef(false)
  const allowNavigationRef = useRef(false)
  const isDirty = JSON.stringify(values) !== JSON.stringify(initialValues)
  const safeReturnTo = safeLeadReturnTarget(returnTo, '')
  const fallbackTarget = lead ? leadDrawerTarget(lead.id) : '/leads'

  const shouldBlockNavigation = useCallback(() => isDirty && !allowNavigationRef.current, [isDirty])
  const blocker = useBlocker(shouldBlockNavigation)

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm(t('leadForm.discardMessage'))) blocker.proceed()
    else blocker.reset()
  }, [blocker, t])

  useBeforeUnload(useCallback((event) => {
    if (!isDirty || allowNavigationRef.current) return
    event.preventDefault()
  }, [isDirty]))

  const setField = <K extends keyof LeadDetailsValues>(field: K, value: LeadDetailsValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
    setDuplicatePrompt(null)
  }

  const navigateAfterSave = async (leadId: string) => {
    allowNavigationRef.current = true
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: campaignQueryKeys.all }),
    ])
    navigate(safeReturnTo || leadDrawerTarget(leadId), { replace: true })
  }

  const save = async (allowCompanyDuplicate = false) => {
    if (saveLockRef.current || saveCompletedRef.current) return
    const nextErrors = validateLeadDetails(values)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    saveLockRef.current = true
    setIsSaving(true)
    setFormError(null)
    try {
      const duplicates = await findLeadDuplicates(values, lead?.id)
      const exactMatches = duplicates.filter((match) => match.exactIdentifier)
      if (exactMatches.length) {
        setDuplicatePrompt({ kind: 'exact', matches: exactMatches })
        return
      }
      const companyMatches = duplicates.filter((match) => !match.exactIdentifier)
      if (mode === 'create' && companyMatches.length && !allowCompanyDuplicate) {
        setDuplicatePrompt({ kind: 'company', matches: companyMatches })
        return
      }

      const normalized = normalizeLeadDetails(values)
      if (mode === 'create') {
        const created = await createLeadFromDetails(normalized)
        saveCompletedRef.current = true
        await navigateAfterSave(created.id)
      } else if (lead) {
        const changedFields = changedLeadDetailFields(initialValues, values)
        const updated = await updateLeadDetails(lead.id, normalized, changedFields)
        saveCompletedRef.current = true
        await navigateAfterSave(updated.id)
      }
    } catch (error) {
      if (error instanceof LeadUniqueViolationError) {
        const matches = await findLeadDuplicates(values, lead?.id).catch(() => [])
        setDuplicatePrompt({ kind: 'exact', matches })
      } else setFormError(t('leadForm.error.save'))
    } finally {
      saveLockRef.current = false
      setIsSaving(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void save(false)
  }

  const handleCancel = () => {
    if (isDirty && !window.confirm(t('leadForm.discardMessage'))) return
    allowNavigationRef.current = true
    navigate(safeReturnTo || fallbackTarget)
  }

  const duplicateLead = duplicatePrompt?.matches[0]?.lead

  return (
    <form noValidate onSubmit={handleSubmit} className="mx-auto w-full max-w-4xl pb-24" data-testid="lead-details-form">
      <div className="flex flex-col gap-3 border-b border-zinc-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('leadForm.eyebrow')}</p>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-900">{t(mode === 'create' ? 'leadForm.createTitle' : 'leadForm.editTitle')}</h1>
          <p className="mt-2 text-sm text-zinc-600">{t('leadForm.subtitle')}</p>
        </div>
        <button type="button" onClick={handleCancel} disabled={isSaving} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-700 disabled:opacity-50">
          {t('leadForm.cancel')}
        </button>
      </div>

      {formError ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{formError}</p> : null}

      {duplicatePrompt ? (
        <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" data-testid="lead-duplicate-warning">
          <h2 className="font-semibold">{t(duplicatePrompt.kind === 'exact' ? 'leadForm.duplicate.exactTitle' : 'leadForm.duplicate.companyTitle')}</h2>
          <p className="mt-1">{t(duplicatePrompt.kind === 'exact' ? 'leadForm.duplicate.exactBody' : 'leadForm.duplicate.companyBody')}</p>
          {duplicateLead ? <p className="mt-2 font-medium">{duplicateLead.company_name}{duplicateLead.email ? ` · ${duplicateLead.email}` : ''}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {duplicateLead ? <button type="button" onClick={() => { allowNavigationRef.current = true; navigate(leadDrawerTarget(duplicateLead.id)) }} className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white">{t('leadForm.duplicate.open')}</button> : null}
            {duplicatePrompt.kind === 'company' ? <button type="button" onClick={() => void save(true)} disabled={isSaving} className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-medium">{t('leadForm.duplicate.createAnyway')}</button> : null}
            <button type="button" onClick={() => setDuplicatePrompt(null)} className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm">{t('leadForm.duplicate.cancel')}</button>
          </div>
        </section>
      ) : null}

      <FormSection title={t('leadForm.section.basic')}>
        <Field label={t('leadForm.field.company')} required value={values.company_name} error={errors.company_name ? t('leadForm.validation.company') : undefined} onChange={(value) => setField('company_name', value)} />
        <Field label={t('leadForm.field.contact')} value={values.contact_name} onChange={(value) => setField('contact_name', value)} />
      </FormSection>

      <FormSection title={t('leadForm.section.channels')} description={t('leadForm.channelHint')}>
        <Field type="email" label={t('leadForm.field.email')} value={values.email} error={errors.email ? t('leadForm.validation.email') : undefined} onChange={(value) => setField('email', value)} />
        <Field type="tel" label={t('leadForm.field.phone')} value={values.phone} onChange={(value) => setField('phone', value)} />
        <Field label={t('leadForm.field.website')} value={values.website} error={errors.website ? t('leadForm.validation.website') : undefined} placeholder="example.com" onChange={(value) => setField('website', value)} />
        <label className="space-y-1.5"><span className="text-sm font-medium text-zinc-800">{t('leadForm.field.preferredChannel')}</span><select value={values.preferred_channel} onChange={(event) => setField('preferred_channel', event.target.value as LeadDetailsValues['preferred_channel'])} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm"><option value="">{t('leadForm.none')}</option>{channels.map((channel) => <option key={channel} value={channel}>{t('campaigns.channel.' + channel)}</option>)}</select></label>
        {!hasEnteredContactChannel(values) ? <p className="sm:col-span-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('leadForm.channelMissing')}</p> : null}
      </FormSection>

      <FormSection title={t('leadForm.section.business')}>
        <Field label={t('leadForm.field.niche')} value={values.niche} onChange={(value) => setField('niche', value)} />
        <Field label={t('leadForm.field.location')} value={values.country_city} onChange={(value) => setField('country_city', value)} />
        <label className="space-y-1.5"><span className="text-sm font-medium text-zinc-800">{t('leadForm.field.language')}</span><select value={values.language} onChange={(event) => setField('language', event.target.value as LeadDetailsValues['language'])} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm"><option value="">{t('leadForm.none')}</option>{languages.map((language) => <option key={language} value={language}>{t('lang.' + language)}</option>)}</select></label>
      </FormSection>

      <section className="mt-5 rounded-3xl border border-zinc-200 bg-white p-5 sm:p-6">
        <h2 className="font-semibold text-zinc-900">{t('leadForm.section.context')}</h2>
        <label className="mt-4 block space-y-1.5"><span className="text-sm font-medium text-zinc-800">{t('leadForm.field.notes')}</span><textarea rows={7} value={values.notes} onChange={(event) => setField('notes', event.target.value)} className="w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm" /></label>
      </section>

      <div className="sticky bottom-0 mt-6 flex items-center justify-end gap-3 border-t border-zinc-200 bg-white/95 py-4 backdrop-blur">
        <button type="button" onClick={handleCancel} disabled={isSaving} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-700 disabled:opacity-50">{t('leadForm.cancel')}</button>
        <button type="submit" disabled={isSaving} data-testid="lead-save" className="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{isSaving ? t('leadForm.saving') : t(mode === 'create' ? 'leadForm.saveLead' : 'leadForm.saveChanges')}</button>
      </div>
    </form>
  )
}

function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="mt-5 rounded-3xl border border-zinc-200 bg-white p-5 sm:p-6"><h2 className="font-semibold text-zinc-900">{title}</h2>{description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}<div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div></section>
}

function Field({ label, value, onChange, error, required, type = 'text', placeholder }: { label: string; value: string; onChange: (value: string) => void; error?: string; required?: boolean; type?: string; placeholder?: string }) {
  return <label className="space-y-1.5"><span className="text-sm font-medium text-zinc-800">{label}{required ? ' *' : ''}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-invalid={Boolean(error)} className={`w-full rounded-xl border bg-white px-3 py-2.5 text-sm ${error ? 'border-red-300' : 'border-zinc-200'}`} />{error ? <span className="block text-xs text-red-600">{error}</span> : null}</label>
}

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { useI18n } from '../../../i18n/i18n'
import { supabase } from '../../../lib/supabase'

type WizardStep = 'upload' | 'preview' | 'mapping' | 'dedup'
type ImportField = 'company_name' | 'email' | 'website' | 'phone' | 'niche' | 'contact_name' | 'country_city' | 'notes'
type DedupReason = 'duplicate_email' | 'duplicate_domain' | 'duplicate_phone' | 'missing_company_name' | 'invalid_row'

type RawRow = Record<string, string>
type NormalizedRow = {
  raw: RawRow
  __index: number
  __emailNorm: string | null
  __domainNorm: string | null
  __phoneNorm: string | null
  __dedupKey: string | null
}

type ImportReport = {
  imported: number
  skipped: number
  reasons: Record<DedupReason, number>
}

type LeadInsertRow = {
  company_name: string
  email: string | null
  website: string | null
  phone: string | null
  niche: string | null
  contact_name: string | null
  country_city: string | null
  notes: string | null
  source_file: string
}

const steps: WizardStep[] = ['upload', 'preview', 'mapping', 'dedup']
const previewRowsCount = 10
const chunkSize = 200
const insertBatchSize = 75

const requiredFields: ImportField[] = ['company_name']
const optionalFields: ImportField[] = ['email', 'website', 'phone', 'niche', 'contact_name', 'country_city', 'notes']

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeEmail(value: string | undefined): string | null {
  const normalized = normalizeText(value)
  return normalized ? normalized.toLowerCase() : null
}

function domainFromWebsite(value: string | undefined): string | null {
  const raw = normalizeText(value)
  if (!raw) return null

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`

  try {
    const hostname = new URL(withProtocol).hostname.toLowerCase()
    return hostname.replace(/^www\./, '') || null
  } catch {
    return raw.toLowerCase().replace(/^www\./, '')
  }
}

function normalizePhone(value: string | undefined): string | null {
  const normalized = normalizeText(value)
  if (!normalized) return null

  const cleaned = normalized.replace(/[^0-9+]/g, '')
  return cleaned || null
}

function pickDedupKey(emailNorm: string | null, domainNorm: string | null, phoneNorm: string | null): string | null {
  if (emailNorm) return `email:${emailNorm}`
  if (domainNorm) return `domain:${domainNorm}`
  if (phoneNorm) return `phone:${phoneNorm}`
  return null
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

function toStringRecord(row: unknown): RawRow {
  const source = (row ?? {}) as Record<string, unknown>
  const out: RawRow = {}
  for (const [key, value] of Object.entries(source)) {
    out[key] = value == null ? '' : String(value)
  }
  return out
}

function emptyReasonCounters(): Record<DedupReason, number> {
  return {
    duplicate_email: 0,
    duplicate_domain: 0,
    duplicate_phone: 0,
    missing_company_name: 0,
    invalid_row: 0,
  }
}

function dedupReasonFromKey(key: string | null): DedupReason {
  if (key?.startsWith('email:')) return 'duplicate_email'
  if (key?.startsWith('domain:')) return 'duplicate_domain'
  if (key?.startsWith('phone:')) return 'duplicate_phone'
  return 'invalid_row'
}

async function resolveCurrentOrgId() {
  const { data: memberships, error } = await supabase
    .from('memberships')
    .select('org_id, created_at')
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) throw error
  return memberships?.[0]?.org_id ?? null
}

export function ImportsPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<RawRow[]>([])
  const [stepIndex, setStepIndex] = useState(0)
  const [mapping, setMapping] = useState<Record<ImportField, string>>({
    company_name: '',
    email: '',
    website: '',
    phone: '',
    niche: '',
    contact_name: '',
    country_city: '',
    notes: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)

  const currentStep = steps[stepIndex]

  const normalizedRows = useMemo<NormalizedRow[]>(() => {
    return rows.map((row, index) => {
      const email = mapping.email ? row[mapping.email] : undefined
      const website = mapping.website ? row[mapping.website] : undefined
      const phone = mapping.phone ? row[mapping.phone] : undefined

      const emailNorm = normalizeEmail(email)
      const domainNorm = domainFromWebsite(website)
      const phoneNorm = normalizePhone(phone)

      return {
        raw: row,
        __index: index,
        __emailNorm: emailNorm,
        __domainNorm: domainNorm,
        __phoneNorm: phoneNorm,
        __dedupKey: pickDedupKey(emailNorm, domainNorm, phoneNorm),
      }
    })
  }, [mapping.email, mapping.phone, mapping.website, rows])

  const inFileDuplicateRowIndexes = useMemo(() => {
    const keyCount = new Map<string, number>()
    const duplicates = new Set<number>()

    normalizedRows.forEach((row) => {
      if (!row.__dedupKey) return
      keyCount.set(row.__dedupKey, (keyCount.get(row.__dedupKey) ?? 0) + 1)
    })

    normalizedRows.forEach((row) => {
      if (!row.__dedupKey) return
      if ((keyCount.get(row.__dedupKey) ?? 0) > 1) duplicates.add(row.__index)
    })

    return duplicates
  }, [normalizedRows])

  const dedupMutation = useMutation({
    mutationFn: async () => {
      const orgId = await resolveCurrentOrgId()
      if (!orgId) return { inDbDuplicates: 0, eligible: 0, matchedIndexes: new Set<number>() }

      const emailNorms = Array.from(new Set(normalizedRows.map((r) => r.__emailNorm).filter((v): v is string => Boolean(v))))
      const domainNorms = Array.from(new Set(normalizedRows.map((r) => r.__domainNorm).filter((v): v is string => Boolean(v))))
      const phoneNorms = Array.from(new Set(normalizedRows.map((r) => r.__phoneNorm).filter((v): v is string => Boolean(v))))

      const foundEmail = new Set<string>()
      const foundDomain = new Set<string>()
      const foundPhone = new Set<string>()

      for (const chunk of chunkArray(emailNorms, chunkSize)) {
        const { data, error: chunkError } = await supabase
          .from('leads')
          .select('email_norm')
          .eq('org_id', orgId)
          .in('email_norm', chunk)
        if (chunkError) throw chunkError
        data?.forEach((lead) => {
          if (lead.email_norm) foundEmail.add(lead.email_norm)
        })
      }

      for (const chunk of chunkArray(domainNorms, chunkSize)) {
        const { data, error: chunkError } = await supabase
          .from('leads')
          .select('website_domain_norm')
          .eq('org_id', orgId)
          .in('website_domain_norm', chunk)
        if (chunkError) throw chunkError
        data?.forEach((lead) => {
          if (lead.website_domain_norm) foundDomain.add(lead.website_domain_norm)
        })
      }

      for (const chunk of chunkArray(phoneNorms, chunkSize)) {
        const { data, error: chunkError } = await supabase
          .from('leads')
          .select('phone_norm')
          .eq('org_id', orgId)
          .in('phone_norm', chunk)
        if (chunkError) throw chunkError
        data?.forEach((lead) => {
          if (lead.phone_norm) foundPhone.add(lead.phone_norm)
        })
      }

      const matchedIndexes = new Set<number>()
      normalizedRows.forEach((row) => {
        if (row.__emailNorm && foundEmail.has(row.__emailNorm)) matchedIndexes.add(row.__index)
        else if (row.__domainNorm && foundDomain.has(row.__domainNorm)) matchedIndexes.add(row.__index)
        else if (row.__phoneNorm && foundPhone.has(row.__phoneNorm)) matchedIndexes.add(row.__index)
      })

      const eligible = normalizedRows.filter((row) => {
        const companyName = mapping.company_name ? row.raw[mapping.company_name]?.trim() : ''
        return Boolean(companyName) && !inFileDuplicateRowIndexes.has(row.__index) && !matchedIndexes.has(row.__index)
      }).length

      return { inDbDuplicates: matchedIndexes.size, eligible, matchedIndexes }
    },
  })

  const importRunMutation = useMutation({
    mutationFn: async () => {
      const orgId = await resolveCurrentOrgId()
      if (!orgId) throw new Error('org_not_found')

      const dedupRules = {
        priority: ['email', 'domain', 'phone'],
        in_file: true,
        db_org_scoped: true,
      }

      const { data: importRecord, error: importCreateError } = await supabase
        .from('imports')
        .insert({
          file_name: fileName,
          rows_total: rows.length,
          mapping_json: mapping,
          dedup_rules: dedupRules,
          rows_imported: 0,
          rows_skipped: 0,
        })
        .select('id')
        .single()

      if (importCreateError) throw importCreateError

      const importId = importRecord.id as string
      const reasons = emptyReasonCounters()
      const dbDupes = dedupMutation.data?.matchedIndexes ?? new Set<number>()

      const payloads: Array<{ index: number; lead: LeadInsertRow }> = []

      normalizedRows.forEach((row) => {
        const companyName = mapping.company_name ? normalizeText(row.raw[mapping.company_name]) : null
        if (!companyName) {
          reasons.missing_company_name += 1
          return
        }

        if (!row.__dedupKey) {
          reasons.invalid_row += 1
          return
        }

        if (inFileDuplicateRowIndexes.has(row.__index)) {
          reasons[dedupReasonFromKey(row.__dedupKey)] += 1
          return
        }

        if (dbDupes.has(row.__index)) {
          reasons[dedupReasonFromKey(row.__dedupKey)] += 1
          return
        }

        payloads.push({
          index: row.__index,
          lead: {
              company_name: companyName,
            email: mapping.email ? normalizeText(row.raw[mapping.email]) : null,
            website: mapping.website ? normalizeText(row.raw[mapping.website]) : null,
            phone: mapping.phone ? normalizeText(row.raw[mapping.phone]) : null,
            niche: mapping.niche ? normalizeText(row.raw[mapping.niche]) : null,
            contact_name: mapping.contact_name ? normalizeText(row.raw[mapping.contact_name]) : null,
            country_city: mapping.country_city ? normalizeText(row.raw[mapping.country_city]) : null,
            notes: mapping.notes ? normalizeText(row.raw[mapping.notes]) : null,
            source_file: fileName,
          },
        })
      })

      let importedCount = 0
      const insertedLeads: Array<{ id: string }> = []

      const payloadChunks = chunkArray(payloads, insertBatchSize)
      for (const chunk of payloadChunks) {
        const batchPayload = chunk.map((item) => item.lead)
        const { data, error: batchError } = await supabase.from('leads').insert(batchPayload).select('id')

        if (!batchError && data) {
          importedCount += data.length
          insertedLeads.push(...(data as Array<{ id: string }>))
          continue
        }

        for (const item of chunk) {
          const { data: rowData, error: rowError } = await supabase.from('leads').insert(item.lead).select('id').single()
          if (!rowError && rowData) {
            importedCount += 1
            insertedLeads.push({ id: rowData.id as string })
            continue
          }

          if (rowError?.code === '23505') {
            const original = normalizedRows[item.index]
            reasons[dedupReasonFromKey(original?.__dedupKey ?? null)] += 1
            continue
          }

          throw rowError
        }
      }

      const activityRows = insertedLeads.map((lead) => ({
        lead_id: lead.id,
        type: 'imported',
        meta: { import_id: importId, file_name: fileName },
      }))

      for (const chunk of chunkArray(activityRows, insertBatchSize)) {
        const { error: activityError } = await supabase.from('activities').insert(chunk)
        if (activityError) throw activityError
      }

      const skippedCount = Object.values(reasons).reduce((acc, value) => acc + value, 0)

      const { error: importUpdateError } = await supabase
        .from('imports')
        .update({
          rows_imported: importedCount,
          rows_skipped: skippedCount,
          dedup_rules: { ...dedupRules, skipped_reasons: reasons },
        })
        .eq('id', importId)

      if (importUpdateError) throw importUpdateError

      return { imported: importedCount, skipped: skippedCount, reasons }
    },
  })

  const parseFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!ext || !['xlsx', 'csv'].includes(ext)) {
      setError(t('common.error'))
      return
    }

    setError(null)
    setFileName(file.name)

    if (ext === 'csv') {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: ({ data, meta }) => {
          const parsedRows = data.map((row) => toStringRecord(row)).filter((row) => Object.values(row).some((value) => value.trim() !== ''))
          setHeaders(meta.fields ?? Object.keys(parsedRows[0] ?? {}))
          setRows(parsedRows)
          setStepIndex(1)
        },
        error: () => setError(t('common.error')),
      })
      return
    }

    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' })
    const parsedRows = json.map((row) => toStringRecord(row)).filter((row) => Object.values(row).some((value) => value.trim() !== ''))
    setHeaders(Object.keys(parsedRows[0] ?? {}))
    setRows(parsedRows)
    setStepIndex(1)
  }

  const previewRows = useMemo(() => rows.slice(0, previewRowsCount), [rows])

  const goNext = async () => {
    if (currentStep === 'mapping') {
      if (!mapping.company_name) {
        setError(t('imports.mapping.required'))
        return
      }
      setError(null)
      setStepIndex(3)
      await dedupMutation.mutateAsync()
      return
    }

    if (currentStep === 'dedup') {
      const result = await importRunMutation.mutateAsync()
      setReport(result)
      return
    }

    if (stepIndex < steps.length - 1) setStepIndex((prev) => prev + 1)
  }

  const goBack = () => {
    if (stepIndex > 0) setStepIndex((prev) => prev - 1)
  }

  const resetWizard = () => {
    setStepIndex(0)
    setRows([])
    setHeaders([])
    setFileName('')
    setError(null)
    setReport(null)
    dedupMutation.reset()
    importRunMutation.reset()
  }

  const inFileDupes = inFileDuplicateRowIndexes.size
  const inDbDupes = dedupMutation.data?.inDbDuplicates ?? 0
  const eligibleRows = dedupMutation.data?.eligible ?? 0

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('imports.title')}</h1>
        <p className="mt-1 text-sm text-zinc-600">{t('imports.subtitle')}</p>
      </header>

      {report ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6">
          <p className="text-xs uppercase tracking-wide text-zinc-500">{t('imports.run.done')}</p>
          <h2 className="mt-2 text-lg font-semibold text-zinc-900">{t('imports.report.title')}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
              <p className="text-xs text-zinc-500">{t('imports.report.imported')}</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-900">{report.imported}</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
              <p className="text-xs text-zinc-500">{t('imports.report.skipped')}</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-900">{report.skipped}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-2 text-sm text-zinc-700">
            <p>{t('imports.report.reason.duplicate_email')}: {report.reasons.duplicate_email}</p>
            <p>{t('imports.report.reason.duplicate_domain')}: {report.reasons.duplicate_domain}</p>
            <p>{t('imports.report.reason.duplicate_phone')}: {report.reasons.duplicate_phone}</p>
            <p>{t('imports.report.reason.missing_company_name')}: {report.reasons.missing_company_name}</p>
            <p>{t('imports.report.reason.invalid_row')}: {report.reasons.invalid_row}</p>
          </div>

          <div className="mt-6 flex gap-2">
            <button type="button" onClick={() => navigate('/leads')} className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700">
              {t('imports.report.open_leads')}
            </button>
            <button type="button" onClick={resetWizard} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
              {t('imports.report.new_import')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-2">
            {steps.map((step, index) => (
              <div
                key={step}
                className={`rounded-xl border px-3 py-2 text-xs ${index <= stepIndex ? 'border-zinc-300 bg-zinc-100 text-zinc-900' : 'border-zinc-200 bg-white text-zinc-500'}`}
              >
                {t(`imports.step.${step}`)}
              </div>
            ))}
          </div>

          {error ? <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
          {importRunMutation.isError ? <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{t('common.error')}</div> : null}

          {currentStep === 'upload' ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6">
              <label className="inline-flex cursor-pointer rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
                <span>{t('imports.upload.cta')}</span>
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void parseFile(file)
                  }}
                />
              </label>
              <p className="mt-3 text-sm text-zinc-500">{t('imports.upload.hint')}</p>
              {fileName ? <p className="mt-2 text-sm text-zinc-700">{fileName}</p> : null}
            </div>
          ) : null}

          {currentStep === 'preview' ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-zinc-900">{t('imports.preview.title')}</h2>
              {previewRows.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-500">{t('common.empty')}</p>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200">
                  <table className="min-w-full divide-y divide-zinc-200 text-sm">
                    <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                      <tr>
                        {headers.map((header) => (
                          <th key={header} className="px-3 py-2 font-medium">{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 bg-white">
                      {previewRows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {headers.map((header) => (
                            <td key={`${rowIndex}-${header}`} className="px-3 py-2 text-zinc-700">{row[header] || t('common.empty')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {currentStep === 'mapping' ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-zinc-900">{t('imports.mapping.title')}</h2>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {requiredFields.map((field) => (
                  <label key={field} className="space-y-1">
                    <span className="text-xs text-zinc-500">{t(`imports.field.${field}`)} · {t('imports.mapping.required')}</span>
                    <select
                      value={mapping[field]}
                      onChange={(event) => setMapping((prev) => ({ ...prev, [field]: event.target.value }))}
                      className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                    >
                      <option value="">{t('common.empty')}</option>
                      {headers.map((header) => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </label>
                ))}

                {optionalFields.map((field) => (
                  <label key={field} className="space-y-1">
                    <span className="text-xs text-zinc-500">{t(`imports.field.${field}`)} · {t('imports.mapping.optional')}</span>
                    <select
                      value={mapping[field]}
                      onChange={(event) => setMapping((prev) => ({ ...prev, [field]: event.target.value }))}
                      className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                    >
                      <option value="">{t('common.empty')}</option>
                      {headers.map((header) => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {currentStep === 'dedup' ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-zinc-900">{t('imports.dedup.title')}</h2>

              {dedupMutation.isPending ? <p className="mt-4 text-sm text-zinc-500">{t('common.loading')}</p> : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <p className="text-xs text-zinc-500">{t('imports.dedup.in_file')}</p>
                  <p className="mt-1 text-xl font-semibold text-zinc-900">{inFileDupes}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <p className="text-xs text-zinc-500">{t('imports.dedup.in_db')}</p>
                  <p className="mt-1 text-xl font-semibold text-zinc-900">{inDbDupes}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <p className="text-xs text-zinc-500">{t('imports.dedup.eligible')}</p>
                  <p className="mt-1 text-xl font-semibold text-zinc-900">{eligibleRows}</p>
                </div>
              </div>

              {importRunMutation.isPending ? <p className="mt-5 text-sm text-zinc-500">{t('imports.run.running')}</p> : null}
            </div>
          ) : null}

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              disabled={stepIndex === 0 || importRunMutation.isPending}
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 disabled:opacity-50"
            >
              {t('common.back')}
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={resetWizard}
                disabled={importRunMutation.isPending}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void goNext()}
                disabled={(stepIndex === 0 && rows.length === 0) || importRunMutation.isPending}
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {currentStep === 'dedup' ? t('imports.run.start') : t('common.continue')}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

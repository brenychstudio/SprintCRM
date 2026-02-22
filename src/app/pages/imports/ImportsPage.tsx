import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { useI18n } from '../../../i18n/i18n'
import { supabase } from '../../../lib/supabase'

type WizardStep = 'upload' | 'preview' | 'mapping' | 'dedup'
type ImportField = 'company_name' | 'email' | 'website' | 'phone' | 'niche' | 'contact_name' | 'country_city' | 'notes'

type RawRow = Record<string, string>
type NormalizedRow = {
  raw: RawRow
  __index: number
  __emailNorm: string | null
  __domainNorm: string | null
  __phoneNorm: string | null
  __dedupKey: string | null
}

const steps: WizardStep[] = ['upload', 'preview', 'mapping', 'dedup']
const previewRowsCount = 10
const chunkSize = 200

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

export function ImportsPage() {
  const { t } = useI18n()
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
      const current = keyCount.get(row.__dedupKey) ?? 0
      keyCount.set(row.__dedupKey, current + 1)
    })

    normalizedRows.forEach((row) => {
      if (!row.__dedupKey) return
      if ((keyCount.get(row.__dedupKey) ?? 0) > 1) duplicates.add(row.__index)
    })

    return duplicates
  }, [normalizedRows])

  const dedupMutation = useMutation({
    mutationFn: async () => {
      const { data: memberships, error: membershipsError } = await supabase
        .from('memberships')
        .select('org_id, created_at')
        .order('created_at', { ascending: true })
        .limit(1)

      if (membershipsError) throw membershipsError
      const orgId = memberships?.[0]?.org_id
      if (!orgId) {
        return { inDbDuplicates: 0, eligible: 0, matchedIndexes: new Set<number>() }
      }

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
        const hasCompanyName = Boolean(companyName)
        return hasCompanyName && !inFileDuplicateRowIndexes.has(row.__index) && !matchedIndexes.has(row.__index)
      }).length

      return {
        inDbDuplicates: matchedIndexes.size,
        eligible,
        matchedIndexes,
      }
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
    const firstSheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[firstSheetName]
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' })
    const parsedRows = json.map((row) => toStringRecord(row)).filter((row) => Object.values(row).some((value) => value.trim() !== ''))
    const nextHeaders = Object.keys(parsedRows[0] ?? {})

    setHeaders(nextHeaders)
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

    if (stepIndex < steps.length - 1) setStepIndex((prev) => prev + 1)
  }

  const goBack = () => {
    if (stepIndex > 0) setStepIndex((prev) => prev - 1)
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
                        <td key={`${rowIndex}-${header}`} className="px-3 py-2 text-zinc-700">{row[header] || '—'}</td>
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
          {dedupMutation.isError ? <p className="mt-4 text-sm text-red-700">{t('common.error')}</p> : null}

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
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={goBack}
          disabled={stepIndex === 0}
          className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 disabled:opacity-50"
        >
          {t('common.back')}
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setStepIndex(0)
              setRows([])
              setHeaders([])
              setFileName('')
              setError(null)
              dedupMutation.reset()
            }}
            className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void goNext()}
            disabled={stepIndex === 0 && rows.length === 0}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {t('common.continue')}
          </button>
        </div>
      </div>
    </section>
  )
}

import { useMemo, useState } from 'react'
<<<<<<< HEAD
import * as XLSX from 'xlsx'
import { useI18n } from '../../../i18n/i18n'
import { supabase } from '../../../lib/supabase'
import { isoAtMadridNineAMInDays } from '../../../lib/dates'

type Parsed = {
  headers: string[]
  rows: Record<string, string>[]
}

type Mapping = {
  company_name: string | ''
  website: string | ''
  email: string | ''
  phone: string | ''
  niche: string | ''
  country_city: string | ''
  contact_name: string | ''
  notes: string | ''
}

type SkipReason =
  | 'missing_company_name'
  | 'duplicate_email'
  | 'duplicate_domain'
  | 'duplicate_phone'
  | 'duplicate_db'
  | 'invalid_row'
  | 'insert_error'

type Report = {
  fileName: string
  rowsTotal: number
  rowsImported: number
  rowsSkipped: number
  skippedReasons: Record<SkipReason, number>
}

const FIELDS: Array<{ key: keyof Mapping; labelKey: string; required?: boolean }> = [
  { key: 'company_name', labelKey: 'imports.field.company', required: true },
  { key: 'website', labelKey: 'imports.field.website' },
  { key: 'email', labelKey: 'imports.field.email' },
  { key: 'phone', labelKey: 'imports.field.phone' },
  { key: 'niche', labelKey: 'imports.field.niche' },
  { key: 'country_city', labelKey: 'imports.field.location' },
  { key: 'contact_name', labelKey: 'imports.field.contact' },
  { key: 'notes', labelKey: 'imports.field.notes' },
]

function normalizeEmail(v: string) {
  const s = v.trim().toLowerCase()
  return s || ''
}

function normalizePhone(v: string) {
  const s = v.trim()
  const out = s.replace(/[^0-9+]/g, '')
  return out || ''
}

function extractDomain(input: string) {
  const s = input.trim().toLowerCase()
  if (!s) return ''
  try {
    const withProto = s.startsWith('http://') || s.startsWith('https://') ? s : `https://${s}`
    const u = new URL(withProto)
    return u.hostname.replace(/^www\./, '')
  } catch {
    // fallback: strip path
    const cleaned = s.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '')
    return cleaned || ''
  }
}

function guessMapping(headers: string[]): Mapping {
  const h = headers.map((x) => x.toLowerCase().trim())
  const pick = (pred: (s: string) => boolean) => {
    const idx = h.findIndex(pred)
    return idx >= 0 ? headers[idx] : ''
  }

  return {
    company_name: pick((s) => s.includes('company') || s.includes('empresa') || s.includes('компан') || s.includes('компани') || s === 'name'),
    website: pick((s) => s.includes('website') || s.includes('site') || s.includes('url') || s.includes('web')),
    email: pick((s) => s.includes('email') || s.includes('e-mail') || s.includes('mail')),
    phone: pick((s) => s.includes('phone') || s.includes('tel') || s.includes('mobile') || s.includes('telefono') || s.includes('тел')),
    niche: pick((s) => s.includes('niche') || s.includes('industry') || s.includes('sector') || s.includes('category')),
    country_city: pick((s) => s.includes('city') || s.includes('country') || s.includes('location') || s.includes('ciudad') || s.includes('país') || s.includes('місто')),
    contact_name: pick((s) => s.includes('contact') || s.includes('person') || s.includes('name contact') || s.includes('контакт')),
    notes: pick((s) => s.includes('note') || s.includes('comment') || s.includes('notes') || s.includes('coment') || s.includes('прим')),
  }
}

async function parseXlsx(file: File): Promise<Parsed> {
  const ab = await file.arrayBuffer()
  const wb = XLSX.read(ab, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown as string[][]
  const headerRow = (rows[0] ?? []).map((x) => String(x ?? '').trim())
  const headers = headerRow.map((h, i) => (h ? h : `col_${i + 1}`))
  const dataRows = rows.slice(1)

  const objects: Record<string, string>[] = dataRows
    .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
    .map((r) => {
      const o: Record<string, string> = {}
      headers.forEach((key, i) => (o[key] = String(r[i] ?? '').trim()))
      return o
    })

  return { headers, rows: objects }
}

function parseCsvText(text: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim() !== '')
  const out: string[][] = []
  for (const line of lines) {
    // lightweight CSV parse: handles quotes
    const row: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
        continue
      }
      if (ch === '"') {
        inQ = !inQ
        continue
      }
      if (!inQ && (ch === ',' || ch === ';' || ch === '\t')) {
        row.push(cur.trim())
        cur = ''
        continue
      }
      cur += ch
    }
    row.push(cur.trim())
    out.push(row)
=======
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
  org_id: string
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
>>>>>>> main
  }
  return out
}

<<<<<<< HEAD
async function parseCsv(file: File): Promise<Parsed> {
  const text = await file.text()
  const rows = parseCsvText(text)
  const headerRow = (rows[0] ?? []).map((x) => String(x ?? '').trim())
  const headers = headerRow.map((h, i) => (h ? h : `col_${i + 1}`))
  const dataRows = rows.slice(1)

  const objects: Record<string, string>[] = dataRows
    .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
    .map((r) => {
      const o: Record<string, string> = {}
      headers.forEach((key, i) => (o[key] = String(r[i] ?? '').trim()))
      return o
    })

  return { headers, rows: objects }
=======
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
>>>>>>> main
}

export function ImportsPage() {
  const { t } = useI18n()
<<<<<<< HEAD

  const [step, setStep] = useState<'upload' | 'preview' | 'mapping' | 'dedup' | 'report'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [mapping, setMapping] = useState<Mapping | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [dedupInfo, setDedupInfo] = useState<{ total: number; dupInFile: number; ready: boolean }>({
    total: 0,
    dupInFile: 0,
    ready: false,
  })

  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<Report | null>(null)

  const previewRows = useMemo(() => parsed?.rows.slice(0, 10) ?? [], [parsed])
  const headers = parsed?.headers ?? []

  async function handleFile(f: File) {
    setError(null)
    setReport(null)
    setFile(f)
    setParsed(null)
    setMapping(null)
    setDedupInfo({ total: 0, dupInFile: 0, ready: false })
    setStep('upload')

    try {
      const ext = f.name.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx'
      const p = ext === 'csv' ? await parseCsv(f) : await parseXlsx(f)
      setParsed(p)
      setMapping(guessMapping(p.headers))
      setStep('preview')
    } catch (e) {
      setError(t('imports.error.parse'))
    }
  }

  function computeDedup() {
    if (!parsed || !mapping) return
    const emailCol = mapping.email
    const phoneCol = mapping.phone
    const webCol = mapping.website

    const seenEmail = new Set<string>()
    const seenPhone = new Set<string>()
    const seenDomain = new Set<string>()

    let dup = 0
    for (const r of parsed.rows) {
      const email = emailCol ? normalizeEmail(r[emailCol] ?? '') : ''
      const phone = phoneCol ? normalizePhone(r[phoneCol] ?? '') : ''
      const domain = webCol ? extractDomain(r[webCol] ?? '') : ''
      const hit =
        (email && seenEmail.has(email)) || (phone && seenPhone.has(phone)) || (domain && seenDomain.has(domain))
      if (hit) dup++
      if (email) seenEmail.add(email)
      if (phone) seenPhone.add(phone)
      if (domain) seenDomain.add(domain)
    }

    setDedupInfo({ total: parsed.rows.length, dupInFile: dup, ready: true })
    setStep('dedup')
  }

  async function runImport() {
  if (!parsed || !mapping || !file) return
  const sourceFile: string = file.name

  setRunning(true)
  setError(null)

    const skippedReasons: Record<SkipReason, number> = {
      missing_company_name: 0,
      duplicate_email: 0,
      duplicate_domain: 0,
      duplicate_phone: 0,
      duplicate_db: 0,
      invalid_row: 0,
      insert_error: 0,
    }

    const rowsTotal = parsed.rows.length
    let rowsImported = 0
    let rowsSkipped = 0

    const mapVal = (row: Record<string, string>, key: keyof Mapping) => {
      const col = mapping[key]
      return col ? String(row[col] ?? '').trim() : ''
    }

    // Pre-dedup in-file (email/domain/phone)
    const seenEmail = new Set<string>()
    const seenPhone = new Set<string>()
    const seenDomain = new Set<string>()

    const candidates: Array<{
      company_name: string
      website: string | null
      website_domain: string | null
      email: string | null
      phone: string | null
      niche: string | null
      country_city: string | null
      contact_name: string | null
      notes: string | null
      source_file: string
      status: 'active'
      stage: 'new'
      next_action: 'follow_up'
      next_action_at: string
      last_touch_at: string
    }> = []

    for (const row of parsed.rows) {
      const company = mapVal(row, 'company_name')
      if (!company) {
        rowsSkipped++
        skippedReasons.missing_company_name++
        continue
      }

      const websiteRaw = mapVal(row, 'website')
      const emailRaw = mapVal(row, 'email')
      const phoneRaw = mapVal(row, 'phone')

      const email = emailRaw ? normalizeEmail(emailRaw) : ''
      const phone = phoneRaw ? normalizePhone(phoneRaw) : ''
      const domain = websiteRaw ? extractDomain(websiteRaw) : ''

      const dup =
        (email && seenEmail.has(email)) || (phone && seenPhone.has(phone)) || (domain && seenDomain.has(domain))

      if (dup) {
        rowsSkipped++
        if (email && seenEmail.has(email)) skippedReasons.duplicate_email++
        else if (domain && seenDomain.has(domain)) skippedReasons.duplicate_domain++
        else if (phone && seenPhone.has(phone)) skippedReasons.duplicate_phone++
        else skippedReasons.invalid_row++
        continue
      }

      if (email) seenEmail.add(email)
      if (phone) seenPhone.add(phone)
      if (domain) seenDomain.add(domain)

      candidates.push({
        company_name: company,
        website: websiteRaw || null,
        website_domain: domain || null,
        email: email || null,
        phone: phone || null,
        niche: mapVal(row, 'niche') || null,
        country_city: mapVal(row, 'country_city') || null,
        contact_name: mapVal(row, 'contact_name') || null,
        notes: mapVal(row, 'notes') || null,
        source_file: file.name,
        status: 'active',
        stage: 'new',
        next_action: 'follow_up',
        next_action_at: isoAtMadridNineAMInDays(3),
        last_touch_at: new Date().toISOString(),
      })
    }

    // Insert in batches; on batch error -> fallback row-by-row
    const BATCH = 250

    async function insertOne(payload: (typeof candidates)[number]) {
      const { data, error } = await supabase.from('leads').insert(payload).select('id').single()
      if (error) {
        if ((error as any).code === '23505') {
          rowsSkipped++
          skippedReasons.duplicate_db++
          return null
        }
        rowsSkipped++
        skippedReasons.insert_error++
        return null
      }
      rowsImported++
      // activity imported (best-effort)
      await supabase.from('activities').insert({
        lead_id: data.id,
        type: 'imported',
        meta: { source_file: sourceFile },
      })
      return data.id as string
    }

    try {
      for (let i = 0; i < candidates.length; i += BATCH) {
        const chunk = candidates.slice(i, i + BATCH)
        const { data, error } = await supabase.from('leads').insert(chunk).select('id')
        if (error) {
          // fallback row-by-row to classify duplicates/errors
          for (const row of chunk) {
            await insertOne(row)
          }
          continue
        }

        rowsImported += data?.length ?? 0

        // activity batch (best-effort)
        const ids = (data ?? []).map((x: any) => x.id)
        if (ids.length) {
          const acts = ids.map((id: string) => ({
            lead_id: id,
            type: 'imported',
            meta: { source_file: sourceFile },
          }))
          await supabase.from('activities').insert(acts)
        }
      }

      // save imports summary (best-effort)
      await supabase.from('imports').insert({
        file_name: sourceFile,
        rows_total: rowsTotal,
        rows_imported: rowsImported,
        rows_skipped: rowsSkipped,
        mapping_json: mapping,
        dedup_rules: { primary: 'email', secondary: 'domain', tertiary: 'phone' },
      })
    } catch {
      setError(t('imports.error.import'))
    } finally {
      setRunning(false)
    }

    setReport({
      fileName: file.name,
      rowsTotal,
      rowsImported,
      rowsSkipped,
      skippedReasons,
    })
    setStep('report')
  }

  function reset() {
    setStep('upload')
    setFile(null)
    setParsed(null)
    setMapping(null)
    setError(null)
    setDedupInfo({ total: 0, dupInFile: 0, ready: false })
    setRunning(false)
    setReport(null)
  }

  return (
    <section>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">{t('imports.title')}</h1>
          <p className="mt-1 text-sm text-zinc-600">{t('imports.subtitle')}</p>
        </div>
        {step !== 'upload' ? (
          <button
            type="button"
            onClick={reset}
            className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
          >
            {t('imports.new')}
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span className={step === 'upload' ? 'text-zinc-900' : ''}>{t('imports.step.upload')}</span>
          <span>·</span>
          <span className={step === 'preview' ? 'text-zinc-900' : ''}>{t('imports.step.preview')}</span>
          <span>·</span>
          <span className={step === 'mapping' ? 'text-zinc-900' : ''}>{t('imports.step.mapping')}</span>
          <span>·</span>
          <span className={step === 'dedup' ? 'text-zinc-900' : ''}>{t('imports.step.dedup')}</span>
          <span>·</span>
          <span className={step === 'report' ? 'text-zinc-900' : ''}>{t('imports.step.report')}</span>
        </div>

        {step === 'upload' ? (
          <div className="mt-4">
            <label className="block">
              <span className="text-sm font-medium text-zinc-900">{t('imports.chooseFile')}</span>
              <input
                type="file"
                accept=".xlsx,.csv"
                className="mt-2 block w-full text-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                }}
              />
            </label>
            <p className="mt-2 text-xs text-zinc-500">{t('imports.fileHint')}</p>
          </div>
        ) : null}

        {step === 'preview' && parsed ? (
          <div className="mt-4">
            <div className="text-sm text-zinc-700">
              {t('imports.previewRows')}: <span className="font-medium">{Math.min(10, parsed.rows.length)}</span> /{' '}
              {parsed.rows.length}
            </div>

            <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200">
              <table className="min-w-full divide-y divide-zinc-200 text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    {headers.slice(0, 6).map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 bg-white text-zinc-700">
                  {previewRows.map((r, idx) => (
                    <tr key={idx}>
                      {headers.slice(0, 6).map((h) => (
                        <td key={h} className="px-3 py-2">
                          {r[h] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
                onClick={() => setStep('mapping')}
              >
                {t('imports.continue')}
              </button>
              <button
                type="button"
                className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
                onClick={reset}
              >
                {t('imports.back')}
              </button>
            </div>
          </div>
        ) : null}

        {step === 'mapping' && parsed && mapping ? (
          <div className="mt-4">
            <div className="grid gap-3 md:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={f.key} className="space-y-1">
                  <span className="text-xs text-zinc-500">
                    {t(f.labelKey)} {f.required ? `· ${t('imports.required')}` : ''}
                  </span>
                  <select
                    value={mapping[f.key]}
                    onChange={(e) => setMapping((m) => ({ ...(m as Mapping), [f.key]: e.target.value }))}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-200"
                  >
                    <option value="">{t('imports.ignore')}</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white transition hover:bg-zinc-800"
                onClick={computeDedup}
                disabled={!mapping.company_name}
              >
                {t('imports.continue')}
              </button>
              <button
                type="button"
                className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
                onClick={() => setStep('preview')}
              >
                {t('imports.back')}
              </button>
            </div>
          </div>
        ) : null}

        {step === 'dedup' && parsed && mapping ? (
          <div className="mt-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">{t('imports.summary.total')}</div>
                <div className="text-lg font-semibold text-zinc-900">{dedupInfo.total}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">{t('imports.summary.duplicates')}</div>
                <div className="text-lg font-semibold text-zinc-900">{dedupInfo.dupInFile}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">{t('imports.summary.ready')}</div>
                <div className="text-lg font-semibold text-zinc-900">{t('imports.readyYes')}</div>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white transition hover:bg-zinc-800 disabled:opacity-60"
                onClick={runImport}
                disabled={running}
              >
                {running ? t('imports.running') : t('imports.run')}
              </button>
              <button
                type="button"
                className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
                onClick={() => setStep('mapping')}
                disabled={running}
              >
                {t('imports.back')}
              </button>
            </div>
          </div>
        ) : null}

        {step === 'report' && report ? (
          <div className="mt-4">
            <div className="text-sm text-zinc-700">
              <span className="font-medium">{report.fileName}</span>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">{t('imports.summary.total')}</div>
                <div className="text-lg font-semibold text-zinc-900">{report.rowsTotal}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">{t('imports.summary.imported')}</div>
                <div className="text-lg font-semibold text-zinc-900">{report.rowsImported}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">{t('imports.summary.skipped')}</div>
                <div className="text-lg font-semibold text-zinc-900">{report.rowsSkipped}</div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
              <div className="text-xs text-zinc-500">{t('imports.skippedReasons')}</div>
              <ul className="mt-2 space-y-1">
                {Object.entries(report.skippedReasons).map(([k, v]) => (
                  <li key={k} className="flex justify-between">
                    <span>{t(`imports.reason.${k}`)}</span>
                    <span className="font-medium">{v}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
                onClick={() => (window.location.href = '/leads')}
              >
                {t('imports.openLeads')}
              </button>
              <button
                type="button"
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white transition hover:bg-zinc-800"
                onClick={reset}
              >
                {t('imports.new')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
=======
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
          org_id: orgId,
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
            org_id: orgId,
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
            <button type="button" className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700">
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
>>>>>>> main

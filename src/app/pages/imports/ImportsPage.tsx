import { useMemo, useState } from 'react'
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
  }
  return out
}

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
}

export function ImportsPage() {
  const { t } = useI18n()

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
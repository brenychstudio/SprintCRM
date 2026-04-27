import { useEffect, useMemo, useRef, useState } from 'react'
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
  importId: string | null
  rowsTotal: number
  rowsImported: number
  rowsSkipped: number
  skippedReasons: Record<SkipReason, number>
}

type SanitySummary = {
  rowsWithContact: number
  rowsWithoutContact: number
  rowsWithoutNiche: number
  rowsWithoutLocation: number
  rowsWithInvalidWebsite: number
  noContactColumnsMapped: boolean
}

type ImportRow = {
  id: string
  file_name?: string | null
  rows_total?: number | null
  rows_imported?: number | null
  rows_skipped?: number | null
  mapping_json?: any
  dedup_rules?: any
  created_at?: string | null
  reverted_at?: string | null
}

type Preset = {
  id: string
  name: string
  mapping: Mapping
  createdAt: string
}

const PRESETS_KEY = 'imports.mappingPresets.v1'
const PREVIEW_PAGE_SIZE = 3
const PREVIEW_HEADERS_LIMIT = 8

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
    const cleaned = s.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '')
    return cleaned || ''
  }
}

function analyzeSanity(parsed: Parsed | null, mapping: Mapping | null): SanitySummary | null {
  if (!parsed || !mapping) return null

  const noContactColumnsMapped = !mapping.email && !mapping.phone && !mapping.website

  let rowsWithContact = 0
  let rowsWithoutContact = 0
  let rowsWithoutNiche = 0
  let rowsWithoutLocation = 0
  let rowsWithInvalidWebsite = 0

  for (const row of parsed.rows) {
    const emailRaw = mapping.email ? String(row[mapping.email] ?? '').trim() : ''
    const phoneRaw = mapping.phone ? String(row[mapping.phone] ?? '').trim() : ''
    const websiteRaw = mapping.website ? String(row[mapping.website] ?? '').trim() : ''
    const nicheRaw = mapping.niche ? String(row[mapping.niche] ?? '').trim() : ''
    const locationRaw = mapping.country_city ? String(row[mapping.country_city] ?? '').trim() : ''

    const email = emailRaw ? normalizeEmail(emailRaw) : ''
    const phone = phoneRaw ? normalizePhone(phoneRaw) : ''
    const domain = websiteRaw ? extractDomain(websiteRaw) : ''

    const hasContact = !!(email || phone || domain)
    if (hasContact) rowsWithContact++
    else rowsWithoutContact++

    if (!nicheRaw) rowsWithoutNiche++
    if (!locationRaw) rowsWithoutLocation++
    if (websiteRaw && !domain) rowsWithInvalidWebsite++
  }

  return {
    rowsWithContact,
    rowsWithoutContact,
    rowsWithoutNiche,
    rowsWithoutLocation,
    rowsWithInvalidWebsite,
    noContactColumnsMapped,
  }
}

function guessMapping(headers: string[]): Mapping {
  const h = headers.map((x) => x.toLowerCase().trim())
  const pick = (pred: (s: string) => boolean) => {
    const idx = h.findIndex(pred)
    return idx >= 0 ? headers[idx] : ''
  }

  return {
    company_name: pick(
      (s) =>
        s.includes('company') ||
        s.includes('agency') ||
        s.includes('empresa') ||
        s.includes('компан') ||
        s.includes('name'),
    ),
    website: pick((s) => s.includes('website') || s.includes('site') || s.includes('url') || s.includes('web')),
    email: pick((s) => s.includes('email') || s.includes('e-mail') || s.includes('mail')),
    phone: pick((s) => s.includes('phone') || s.includes('tel') || s.includes('mobile') || s.includes('telefono') || s.includes('тел')),
    niche: pick((s) => s.includes('niche') || s.includes('industry') || s.includes('sector') || s.includes('category')),
    country_city: pick((s) => s.includes('city') || s.includes('country') || s.includes('location') || s.includes('ciudad') || s.includes('місто')),
    contact_name: pick((s) => s.includes('contact') || s.includes('person') || s.includes('контакт')),
    notes: pick((s) => s.includes('note') || s.includes('comment') || s.includes('notes') || s.includes('coment') || s.includes('прим')),
  }
}

async function parseXlsx(file: File): Promise<Parsed> {
  // lazy-load to keep main bundle smaller
  const XLSX = await import('xlsx')

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

function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Preset[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function savePresets(presets: Preset[]) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
  } catch {
    // ignore
  }
}

function safeApplyPreset(mapping: Mapping, headers: string[]): Mapping {
  const headerSet = new Set(headers)
  const out: Mapping = { ...mapping }
  ;(Object.keys(out) as Array<keyof Mapping>).forEach((k) => {
    const v = out[k]
    out[k] = v && headerSet.has(v) ? v : ''
  })
  return out
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function isNotesPreviewColumn(header: string) {
  const key = header.toLowerCase()
  return key.includes('note') || key.includes('comment') || key.includes('notes')
}

export function ImportsPage() {
  const { t } = useI18n()

  const [view, setView] = useState<'wizard' | 'history'>('wizard')
  const [previewPage, setPreviewPage] = useState(0)

  const [step, setStep] = useState<'upload' | 'preview' | 'mapping' | 'dedup' | 'report'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [mapping, setMapping] = useState<Mapping | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<Report | null>(null)

  const [dedupInfo, setDedupInfo] = useState<{ total: number; dupInFile: number; ready: boolean }>({
    total: 0,
    dupInFile: 0,
    ready: false,
  })

  // History
  const [history, setHistory] = useState<ImportRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const [cleaningId, setCleaningId] = useState<string | null>(null)

  // Presets (localStorage)
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets())
  const [presetName, setPresetName] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    savePresets(presets)
  }, [presets])

  const headers = parsed?.headers ?? []
  const previewTotal = parsed?.rows.length ?? 0
  const previewPageCount = Math.max(1, Math.ceil(previewTotal / PREVIEW_PAGE_SIZE))
  const safePreviewPage = Math.min(previewPage, previewPageCount - 1)
  const previewStart = safePreviewPage * PREVIEW_PAGE_SIZE
  const previewEnd = Math.min(previewStart + PREVIEW_PAGE_SIZE, previewTotal)
  const previewNotesHeader = headers.find((header) => isNotesPreviewColumn(header)) ?? ''
  const previewCardHeaders = headers.filter((header) => header !== previewNotesHeader).slice(0, PREVIEW_HEADERS_LIMIT - 1)
  const previewRows = useMemo(() => parsed?.rows.slice(previewStart, previewEnd) ?? [], [parsed, previewStart, previewEnd])
  const sanitySummary = useMemo(() => analyzeSanity(parsed, mapping), [parsed, mapping])

  async function loadHistory() {
    setHistoryLoading(true)
    setError(null)
    setNotice(null)
    try {
      const { data, error: e } = await supabase.from('imports').select('*').limit(50)
      if (e) throw e
      setHistory(((data ?? []) as any[]) as ImportRow[])
    } catch {
      setError(t('imports.history.loadError'))
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    if (view === 'history') loadHistory()
  }, [view])

  function openFilePicker() {
    fileInputRef.current?.click()
  }

  async function handleFile(f: File) {
    setError(null)
    setNotice(null)
    setReport(null)
    setFile(f)
    setParsed(null)
    setMapping(null)
    setDedupInfo({ total: 0, dupInFile: 0, ready: false })
    setStep('upload')
    setView('wizard')

    try {
      const isCsv = f.name.toLowerCase().endsWith('.csv')
      const p = isCsv ? await parseCsv(f) : await parseXlsx(f)
      setParsed(p)
      setMapping(guessMapping(p.headers))
      setStep('preview')
    } catch {
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
        (email && seenEmail.has(email)) ||
        (phone && seenPhone.has(phone)) ||
        (domain && seenDomain.has(domain))

      if (hit) dup++
      if (email) seenEmail.add(email)
      if (phone) seenPhone.add(phone)
      if (domain) seenDomain.add(domain)
    }

    setDedupInfo({ total: parsed.rows.length, dupInFile: dup, ready: true })
    setStep('dedup')
  }

  function saveCurrentMappingAsPreset() {
    if (!mapping) return
    const name = presetName.trim() || `Preset ${new Date().toLocaleDateString()}`
    const id = `p_${Math.random().toString(16).slice(2)}`
    const preset: Preset = { id, name, mapping, createdAt: new Date().toISOString() }
    setPresets((prev) => [preset, ...prev].slice(0, 20))
    setPresetName('')
    setSelectedPresetId(id)
  }

  function applySelectedPreset() {
    if (!mapping) return
    const preset = presets.find((p) => p.id === selectedPresetId)
    if (!preset) return
    setMapping(safeApplyPreset(preset.mapping, headers))
  }

  async function saveHistoryMappingAsPreset(row: ImportRow) {
    const m = row.mapping_json as Mapping | undefined
    if (!m) return
    const id = `p_${Math.random().toString(16).slice(2)}`
    const baseName = row.file_name ? t('imports.preset.fromFile', { file: row.file_name }) : t('imports.preset.fromImport')
    const name = `${baseName} (${new Date().toLocaleDateString()})`
    const preset: Preset = { id, name, mapping: m, createdAt: new Date().toISOString() }
    setPresets((prev) => [preset, ...prev].slice(0, 20))
    setSelectedPresetId(id)
  }

  async function undoImport(importId: string) {
    if (!importId) return

    const importRow = history.find((row) => row.id === importId)

    setUndoingId(importId)
    setError(null)
    setNotice(null)

    try {
      let ids: string[] = []

      const { data: byImportId, error: sourceImportError } = await supabase
        .from('leads')
        .select('id')
        .eq('source_import_id', importId)

      if (sourceImportError) throw sourceImportError

      ids = ((byImportId ?? []) as any[]).map((row) => row.id).filter(Boolean)

      if (!ids.length && importRow?.file_name) {
        const { data: bySourceFile, error: sourceFileError } = await supabase
          .from('leads')
          .select('id')
          .eq('source_file', importRow.file_name)

        if (sourceFileError) throw sourceFileError

        ids = ((bySourceFile ?? []) as any[]).map((row) => row.id).filter(Boolean)
      }

      if (!ids.length) {
        setError(t('imports.history.undoNoLeads'))
        return
      }

      const ok = window.confirm(t('imports.history.undoConfirmWithCount', { count: ids.length }))
      if (!ok) return

      let deletedCount = 0
      const BATCH = 500

      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH)

        const { data: deletedRows, error: deleteError } = await supabase
          .from('leads')
          .delete()
          .in('id', chunk)
          .select('id')

        if (deleteError) throw deleteError

        deletedCount += deletedRows?.length ?? 0
      }

      if (!deletedCount) {
        throw new Error(t('imports.history.undoDeletedZero'))
      }

      const { error: updateImportError } = await supabase
        .from('imports')
        .update({ reverted_at: new Date().toISOString() })
        .eq('id', importId)

      if (updateImportError) throw updateImportError

      await loadHistory()

      setReport(null)
      setStep('upload')
      setView('history')
      setNotice(t('imports.history.undoSuccess', { count: deletedCount }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('imports.history.undoError'))
    } finally {
      setUndoingId(null)
    }
  }

  async function cleanImportRecord(row: ImportRow) {
    if (!row.id) return

    setCleaningId(row.id)
    setError(null)
    setNotice(null)

    try {
      const { data: linkedByImportId, error: linkedError } = await supabase
        .from('leads')
        .select('id')
        .eq('source_import_id', row.id)
        .limit(1)

      if (linkedError) throw linkedError

      if (linkedByImportId?.length) {
        setError(t('imports.history.clearBlocked'))
        return
      }

      let legacyCount = 0

      if (row.file_name) {
        const { data: legacyRows, error: legacyError } = await supabase
          .from('leads')
          .select('id')
          .eq('source_file', row.file_name)
          .limit(20)

        if (legacyError) throw legacyError

        legacyCount = legacyRows?.length ?? 0
      }

      const ok = window.confirm(
        legacyCount > 0
          ? t('imports.history.clearConfirmWithLegacy', { count: legacyCount })
          : t('imports.history.clearConfirm'),
      )

      if (!ok) return

      const { data: deletedRows, error: deleteError } = await supabase
        .from('imports')
        .delete()
        .eq('id', row.id)
        .select('id')

      if (deleteError) throw deleteError

      if (!deletedRows?.length) {
        throw new Error(t('imports.history.clearDeletedZero'))
      }

      await loadHistory()
      setNotice(t('imports.history.clearSuccess'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('imports.history.clearError'))
    } finally {
      setCleaningId(null)
    }
  }

  async function runImport() {
    if (!parsed || !mapping || !file) return
    const sourceFile: string = file.name

    setRunning(true)
    setError(null)
    setNotice(null)

    const skippedReasons: Report['skippedReasons'] = {
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

    // Create an import row FIRST (so we can attach source_import_id to leads)
    let importId: string | null = null
    try {
      const { data, error: e } = await supabase
        .from('imports')
        .insert({
          file_name: sourceFile,
          rows_total: rowsTotal,
          rows_imported: 0,
          rows_skipped: 0,
          mapping_json: mapping,
          dedup_rules: { primary: 'email', secondary: 'domain', tertiary: 'phone' },
        })
        .select('id')
        .single()

      if (!e && data) importId = (data as any).id as string
    } catch {
      importId = null
    }

    const mapVal = (row: Record<string, string>, key: keyof Mapping) => {
      const col = mapping[key]
      return col ? String(row[col] ?? '').trim() : ''
    }

    const seenEmail = new Set<string>()
    const seenPhone = new Set<string>()
    const seenDomain = new Set<string>()

    const candidates: Array<Record<string, any>> = []

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
        (email && seenEmail.has(email)) ||
        (phone && seenPhone.has(phone)) ||
        (domain && seenDomain.has(domain))

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

      const payload: Record<string, any> = {
        company_name: company,
        website: websiteRaw || null,
        website_domain: domain || null,
        email: email || null,
        phone: phone || null,
        niche: mapVal(row, 'niche') || null,
        country_city: mapVal(row, 'country_city') || null,
        contact_name: mapVal(row, 'contact_name') || null,
        notes: mapVal(row, 'notes') || null,
        source_file: sourceFile,
        status: 'active',
        stage: 'new',
        next_action: 'follow_up',
        next_action_at: isoAtMadridNineAMInDays(3),
        last_touch_at: new Date().toISOString(),
      }

      if (importId) payload.source_import_id = importId
      candidates.push(payload)
    }

    const BATCH = 250

    async function insertOne(payload: Record<string, any>) {
      const { data, error } = await supabase.from('leads').insert(payload).select('id').single()

      if (error) {
        const code = (error as any).code
        if (code === '23505') {
          rowsSkipped++
          skippedReasons.duplicate_db++
          return null
        }
        rowsSkipped++
        skippedReasons.insert_error++
        return null
      }

      rowsImported++

      // best-effort activity
      await supabase.from('activities').insert({
        lead_id: (data as any).id,
        type: 'imported',
        meta: { source_file: sourceFile, source_import_id: importId },
      })

      return (data as any).id as string
    }

    try {
      for (let i = 0; i < candidates.length; i += BATCH) {
        const chunk = candidates.slice(i, i + BATCH)

        const { data, error } = await supabase.from('leads').insert(chunk).select('id')

        if (error) {
          for (const row of chunk) {
            await insertOne(row)
          }
          continue
        }

        const ids = ((data ?? []) as any[]).map((x) => x.id).filter(Boolean)
        rowsImported += ids.length

        // best-effort activities batch
        if (ids.length) {
          const acts = ids.map((id: string) => ({
            lead_id: id,
            type: 'imported',
            meta: { source_file: sourceFile, source_import_id: importId },
          }))
          await supabase.from('activities').insert(acts)
        }
      }

      // Update imports summary if we created the row
      if (importId) {
        await supabase
          .from('imports')
          .update({
            rows_imported: rowsImported,
            rows_skipped: rowsSkipped,
            mapping_json: mapping,
            dedup_rules: { primary: 'email', secondary: 'domain', tertiary: 'phone' },
          })
          .eq('id', importId)
      } else {
        // fallback: best-effort summary insert (legacy)
        await supabase.from('imports').insert({
          file_name: sourceFile,
          rows_total: rowsTotal,
          rows_imported: rowsImported,
          rows_skipped: rowsSkipped,
          mapping_json: mapping,
          dedup_rules: { primary: 'email', secondary: 'domain', tertiary: 'phone' },
        })
      }
    } catch {
      setError(t('imports.error.import'))
    } finally {
      setRunning(false)
    }

    setReport({
      fileName: sourceFile,
      importId,
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
    setNotice(null)
    setDedupInfo({ total: 0, dupInFile: 0, ready: false })
    setRunning(false)
    setReport(null)
    setSelectedPresetId('')
    setPresetName('')
  }

  function renderSanitySummary() {
    if (!sanitySummary) return null

    return (
      <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-zinc-900">{t('imports.sanity.title')}</div>
            <div className="mt-1 text-xs text-zinc-500">{t('imports.sanity.subtitle')}</div>
          </div>

          {sanitySummary.noContactColumnsMapped ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {t('imports.sanity.noContactColumnsMapped')}
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3.5">
            <div className="text-xs leading-5 text-zinc-500">{t('imports.sanity.rowsWithContact')}</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">{sanitySummary.rowsWithContact}</div>
          </div>

          <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3.5">
            <div className="text-xs leading-5 text-zinc-500">{t('imports.sanity.rowsWithoutContact')}</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">{sanitySummary.rowsWithoutContact}</div>
          </div>

          <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3.5">
            <div className="text-xs leading-5 text-zinc-500">{t('imports.sanity.rowsWithoutNiche')}</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">{sanitySummary.rowsWithoutNiche}</div>
          </div>

          <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3.5">
            <div className="text-xs leading-5 text-zinc-500">{t('imports.sanity.rowsWithoutLocation')}</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">{sanitySummary.rowsWithoutLocation}</div>
          </div>

          <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3.5">
            <div className="text-xs leading-5 text-zinc-500">{t('imports.sanity.rowsWithInvalidWebsite')}</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">{sanitySummary.rowsWithInvalidWebsite}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="pb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">{t('imports.title')}</h1>
          <p className="mt-1 text-sm text-zinc-600">{t('imports.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('wizard')}
            className={`rounded-xl border px-3 py-2 text-sm transition ${
              view === 'wizard' ? 'border-zinc-200 bg-zinc-100 text-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'
            }`}
          >
            {t('imports.view.wizard')}
          </button>
          <button
            type="button"
            onClick={() => setView('history')}
            className={`rounded-xl border px-3 py-2 text-sm transition ${
              view === 'history' ? 'border-zinc-200 bg-zinc-100 text-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'
            }`}
          >
            {t('imports.view.history')}
          </button>

          {view === 'wizard' && step !== 'upload' ? (
            <button
              type="button"
              onClick={reset}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
            >
              {t('imports.new')}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {notice ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      {view === 'history' ? (
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-700">{t('imports.history.title')}</p>
            <button
              type="button"
              onClick={loadHistory}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
              disabled={historyLoading}
            >
              {t('imports.history.refresh')}
            </button>
          </div>

          {historyLoading ? <p className="mt-4 text-sm text-zinc-500">{t('imports.history.loading')}</p> : null}
          {!historyLoading && !history.length ? <p className="mt-4 text-sm text-zinc-500">{t('imports.history.empty')}</p> : null}

          {!!history.length ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
              <table className="min-w-full divide-y divide-zinc-200 text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('imports.history.table.file')}</th>
                    <th className="px-3 py-2 font-medium">{t('imports.history.table.created')}</th>
                    <th className="px-3 py-2 font-medium">{t('imports.history.table.imported')}</th>
                    <th className="px-3 py-2 font-medium">{t('imports.history.table.skipped')}</th>
                    <th className="px-3 py-2 font-medium">{t('imports.history.table.status')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('imports.history.table.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 bg-white text-zinc-700">
                  {history.map((row) => {
                    const reverted = !!row.reverted_at
                    const id = row.id
                    return (
                      <tr key={id}>
                        <td className="px-3 py-2">{row.file_name ?? '—'}</td>
                        <td className="px-3 py-2">{formatDateTime(row.created_at)}</td>
                        <td className="px-3 py-2">{row.rows_imported ?? 0}</td>
                        <td className="px-3 py-2">{row.rows_skipped ?? 0}</td>
                        <td className="px-3 py-2">{reverted ? t('imports.history.status.reverted') : t('imports.history.status.ok')}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => saveHistoryMappingAsPreset(row)}
                              className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
                              disabled={!row.mapping_json}
                            >
                              {t('imports.preset.save')}
                            </button>
                            <button
                              type="button"
                              onClick={() => undoImport(id)}
                              className="rounded-xl border border-red-200 px-3 py-2 text-sm text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                              disabled={reverted || undoingId === id}
                            >
                              {undoingId === id ? t('imports.history.undoing') : t('imports.history.undo')}
                            </button>
                            <button
                              type="button"
                              onClick={() => cleanImportRecord(row)}
                              disabled={cleaningId === id || undoingId === id}
                              className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                            >
                              {cleaningId === id ? t('imports.history.clearing') : t('imports.history.clearRecord')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : (
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
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                }}
              />

              <div
                onDragEnter={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setIsDragging(true)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setIsDragging(true)
                }}
                onDragLeave={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setIsDragging(false)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setIsDragging(false)
                  const f = e.dataTransfer.files?.[0]
                  if (f) handleFile(f)
                }}
                className={`rounded-2xl border-2 border-dashed p-8 transition ${
                  isDragging
                    ? 'border-zinc-900 bg-zinc-100'
                    : 'border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100/60'
                }`}
              >
                <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
                  <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-xs font-medium tracking-wide text-zinc-500">
                    {t('imports.fileBadge')}
                  </div>

                  <h2 className="mt-4 text-2xl font-semibold text-zinc-900">{t('imports.dropzoneTitle')}</h2>
                  <p className="mt-2 max-w-xl text-sm text-zinc-600">{t('imports.dropzoneSubtitle')}</p>

                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={openFilePicker}
                      className="rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800"
                    >
                      {t('imports.uploadCta')}
                    </button>

                    <span className="text-sm text-zinc-400">{t('imports.dropzoneOr')}</span>

                    <span className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
                      {t('imports.dropzoneBrowse')}
                    </span>
                  </div>

                  <div className="mt-6 grid w-full gap-3 text-left sm:grid-cols-3">
                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('imports.dropzoneFormats')}</div>
                      <div className="mt-2 text-sm text-zinc-700">.csv, .xlsx</div>
                    </div>

                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('imports.step.dedup')}</div>
                      <div className="mt-2 text-sm text-zinc-700">{t('imports.dropzoneDedupHint')}</div>
                    </div>

                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('imports.dropzoneSafe')}</div>
                      <div className="mt-2 text-sm text-zinc-700">{t('imports.dropzoneUndoHint')}</div>
                    </div>
                  </div>

                  <p className="mt-4 text-xs text-zinc-500">{t('imports.fileHint')}</p>
                </div>
              </div>
            </div>
          ) : null}

          {step === 'preview' && parsed ? (
            <div className="mt-4 flex h-[calc(100vh-250px)] min-h-0 flex-col overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-zinc-900">{t('imports.previewRows')}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {previewTotal > 0 ? previewStart + 1 : 0}-{previewEnd} / {previewTotal}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={safePreviewPage <= 0}
                    onClick={() => setPreviewPage((page) => Math.max(0, page - 1))}
                    className="rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>

                  <span className="min-w-16 text-center text-xs text-zinc-500">
                    {safePreviewPage + 1} / {previewPageCount}
                  </span>

                  <button
                    type="button"
                    disabled={safePreviewPage >= previewPageCount - 1}
                    onClick={() => setPreviewPage((page) => Math.min(previewPageCount - 1, page + 1))}
                    className="rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>

              <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {previewRows.map((row, rowIndex) => (
                  <article
                    key={previewStart + rowIndex}
                    className="rounded-xl border border-zinc-200 bg-white p-2.5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-zinc-400">
                          Row {previewStart + rowIndex + 1}
                        </div>
                        <div className="mt-0.5 text-sm font-semibold leading-5 text-zinc-900">
                          {row[previewCardHeaders[0]] || 'Untitled lead'}
                        </div>
                      </div>

                      <div className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500">
                        {previewStart + rowIndex + 1} / {previewTotal}
                      </div>
                    </div>

                    <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {previewCardHeaders.map((header) => (
                        <div key={header} className="min-w-0 rounded-lg border border-zinc-100 bg-zinc-50 px-2.5 py-1.5">
                          <div className="text-[11px] uppercase tracking-wide text-zinc-400">{header}</div>
                          <div className="mt-0.5 max-h-16 overflow-y-auto break-words text-sm leading-5 text-zinc-700">
                            {row[header] || '-'}
                          </div>
                        </div>
                      ))}
                    </div>

                    {previewNotesHeader ? (
                      <details className="mt-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
                        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-zinc-500">
                          {previewNotesHeader}
                        </summary>
                        <div className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-zinc-600">
                          {row[previewNotesHeader] || '-'}
                        </div>
                      </details>
                    ) : null}
                  </article>
                ))}
              </div>

              {headers.length > PREVIEW_HEADERS_LIMIT ? (
                <p className="mt-2 text-xs leading-5 text-zinc-500">
                  Showing a compact preview of the main columns. Continue to mapping to review every column.
                </p>
              ) : null}

              <div className="mt-auto flex shrink-0 gap-2 pt-3">
                <button
                  type="button"
                  className="rounded-xl border border-zinc-900 bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
                  onClick={() => setStep('mapping')}
                >
                  {t('imports.continue')}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
                  onClick={reset}
                >
                  {t('imports.back')}
                </button>
              </div>
            </div>
          ) : null}

          {step === 'mapping' && parsed && mapping ? (
            <div className="mt-4">
              {renderSanitySummary()}

              <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-500">{t('imports.preset.apply')}</div>

                    <div className="mt-2 flex min-w-0 gap-2">
                      <select
                        value={selectedPresetId}
                        onChange={(e) => setSelectedPresetId(e.target.value)}
                        className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="">{t('imports.preset.apply')}</option>
                        {presets.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.name}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        disabled={!selectedPresetId}
                        onClick={applySelectedPreset}
                        className="shrink-0 rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {t('imports.preset.apply')}
                      </button>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-500">{t('imports.preset.saveLabel')}</div>

                    <div className="mt-2 flex min-w-0 gap-2">
                      <input
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        placeholder={t('imports.preset.namePlaceholder')}
                        className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                      />

                      <button
                        type="button"
                        onClick={saveCurrentMappingAsPreset}
                        disabled={!mapping}
                        className="shrink-0 rounded-xl border border-zinc-900 bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {t('imports.preset.saveButton')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-5 grid gap-x-4 gap-y-4 xl:grid-cols-2">
                {FIELDS.map((f) => (
                  <label key={f.key} className="min-w-0 space-y-1.5">
                    <span className="text-xs text-zinc-500">
                      {t(f.labelKey)} {f.required ? `? ${t('imports.required')}` : ''}
                    </span>
                    <select
                      value={mapping[f.key]}
                      onChange={(e) => setMapping((m) => ({ ...(m as Mapping), [f.key]: e.target.value }))}
                      className="w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm"
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
                  className="rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white transition hover:bg-zinc-800 disabled:opacity-60"
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
              {renderSanitySummary()}

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <div className="text-xs text-zinc-500">{t('imports.summary.total')}</div>
                  <div className="text-lg font-semibold text-zinc-900">{dedupInfo.total}</div>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <div className="text-xs text-zinc-500">{t('imports.summary.duplicates')}</div>
                  <div className="text-lg font-semibold text-zinc-900">{dedupInfo.dupInFile}</div>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
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
              {renderSanitySummary()}

              <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Import batch</div>

                <div className="mt-1 break-words text-sm font-medium text-zinc-900">{report.fileName}</div>

                {report.importId ? (
                  <div className="mt-1 max-w-full truncate font-mono text-xs text-zinc-400">{report.importId}</div>
                ) : null}
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

              <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="text-sm font-medium text-zinc-900">{t('imports.report.skippedReasons')}</div>

                <div className="mt-3 divide-y divide-zinc-100">
                  {Object.entries(report.skippedReasons).map(([reason, count]) => (
                    <div key={reason} className="flex items-center justify-between gap-4 py-2 text-sm">
                      <span className="min-w-0 break-words text-zinc-600">{t(`imports.reason.${reason}`)}</span>
                      <span className="shrink-0 font-medium text-zinc-900">{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
                  onClick={() => (window.location.href = '/leads')}
                >
                  {t('imports.openLeads')}
                </button>

                {report.importId ? (
                  <button
                    type="button"
                    className="rounded-xl border border-red-200 px-3 py-2 text-sm text-red-700 transition hover:bg-red-50"
                    onClick={() => undoImport(report.importId as string)}
                  >
                    {t('imports.report.undoThisImport')}
                  </button>
                ) : null}

                <button
                  type="button"
                  className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
                  onClick={() => setView('history')}
                >
                  {t('imports.report.openHistory')}
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
      )}
    </section>
  )
}

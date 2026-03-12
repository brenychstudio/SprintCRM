import { supabase } from '../../lib/supabase'

type Range = { fromISO?: string; toISO?: string }

const PAGE_SIZE = 1000

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(csvEscape).join(',')
  const lines = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(','))
  return [header, ...lines].join('\n')
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function yyyyMmDd(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

async function fetchAll<T extends Record<string, unknown>>(
  table: string,
  select: string,
  apply: (q: any) => any,
): Promise<T[]> {
  const all: T[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let q = supabase.from(table).select(select).range(offset, offset + PAGE_SIZE - 1)
    q = apply(q)

    const { data, error } = await q
    if (error) throw error

    const page = (data ?? []) as unknown as T[]
    all.push(...page)

    if (page.length < PAGE_SIZE) break
  }
  return all
}

export async function exportLeadsCsv(): Promise<void> {
  const columns = [
    'id',
    'company_name',
    'website',
    'website_domain',
    'niche',
    'country_city',
    'contact_name',
    'email',
    'phone',
    'source_file',
    'status',
    'stage',
    'next_action',
    'next_action_at',
    'last_touch_at',
    'created_at',
    'notes',
  ]

  const rows = await fetchAll<Record<string, unknown>>(
    'leads',
    columns.join(','),
    (q) => q.order('created_at', { ascending: false }),
  )

  downloadTextFile(`SprintCRM_leads_${yyyyMmDd()}.csv`, toCsv(rows, columns))
}

export async function exportActivitiesCsv(range: Range): Promise<void> {
  const columns = ['id', 'lead_id', 'type', 'channel', 'at', 'meta']

  const rows = await fetchAll<Record<string, unknown>>('activities', columns.join(','), (q) => {
    if (range.fromISO) q = q.gte('at', range.fromISO)
    if (range.toISO) q = q.lte('at', range.toISO)
    return q.order('at', { ascending: false })
  })

  // meta to JSON string for CSV
  const normalized = rows.map((r) => ({
    ...r,
    meta: r.meta ? JSON.stringify(r.meta) : '',
  }))

  const suffix = range.fromISO || range.toISO ? `_${yyyyMmDd()}_range` : `_${yyyyMmDd()}`
  downloadTextFile(`SprintCRM_activities${suffix}.csv`, toCsv(normalized, columns))
}

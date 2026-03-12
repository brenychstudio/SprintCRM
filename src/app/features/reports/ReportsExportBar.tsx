import { useState } from 'react'
import { useI18n } from '../../../i18n/i18n'
import { exportActivitiesCsv, exportLeadsCsv } from '../../../features/reports/exportCsv'

export function ReportsExportBar({ fromISO, toISO }: { fromISO?: string; toISO?: string }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState<'leads' | 'activities' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(kind: 'leads' | 'activities') {
    setError(null)
    setBusy(kind)
    try {
      if (kind === 'leads') {
        await exportLeadsCsv()
      } else {
        await exportActivitiesCsv({ fromISO, toISO })
      }
    } catch {
      setError(t('reports.export.error'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => run('leads')}
          disabled={!!busy}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60"
        >
          {busy === 'leads' ? t('reports.export.exporting') : t('reports.export.leads')}
        </button>

        <button
          type="button"
          onClick={() => run('activities')}
          disabled={!!busy}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60"
        >
          {busy === 'activities' ? t('reports.export.exporting') : t('reports.export.activities')}
        </button>
      </div>

      {error ? <div className="text-xs text-red-700">{error}</div> : null}
    </div>
  )
}

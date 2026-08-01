/* eslint-disable react-refresh/only-export-components */
import type { Dispatch, SetStateAction } from 'react'
import type { ResearchEvidence } from '../../../features/campaigns/types'
import { useI18n } from '../../../i18n/i18n'

export function contactNameOrFallback(contactName: string | null | undefined, fallback: string): string {
  return contactName?.trim() || fallback
}

export function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function ResearchEvidenceCards({ evidence, setEvidence }: { evidence: ResearchEvidence[]; setEvidence: Dispatch<SetStateAction<ResearchEvidence[]>> }) {
  const { t } = useI18n()
  const update = (index: number, value: Partial<ResearchEvidence>) => setEvidence((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...value } : row))
  return <div data-testid="research-evidence-cards" className="mt-2 grid min-w-0 gap-3 md:grid-cols-2">
    {evidence.map((item, index) => <article key={index} className="min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{t('campaigns.research.sourceNumber', { number: index + 1 })}</p><button type="button" onClick={() => setEvidence((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="shrink-0 text-sm text-zinc-600 dark:text-zinc-300">{t('campaigns.remove')}</button></div>
      {safeExternalUrl(item.url) ? <a href={safeExternalUrl(item.url)!} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-sm text-blue-700 underline dark:text-blue-300">{item.url}</a> : null}
      <label className="mt-3 block space-y-1"><span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{t('campaigns.research.evidenceUrl')}</span><input aria-label={t('campaigns.research.evidenceUrl')} value={item.url} onChange={(event) => update(index, { url: event.target.value })} placeholder={t('campaigns.research.evidenceUrl')} className="w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm break-all dark:border-zinc-700 dark:bg-zinc-900" /></label>
      <label className="mt-3 block space-y-1"><span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{t('campaigns.research.evidenceClaim')}</span><textarea aria-label={t('campaigns.research.evidenceClaim')} value={item.note ?? item.claim ?? ''} onChange={(event) => update(index, { note: event.target.value, claim: undefined })} placeholder={t('campaigns.research.evidenceClaim')} className="min-h-24 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" /></label>
    </article>)}
  </div>
}

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LeadDrawer } from '../../features/leads/LeadDrawer'
import { createLead, leadsQueryKeys, listLeads } from '../../../features/leads/leadsApi'
import type { Lead, LeadDueFilter, LeadStage } from '../../../features/leads/types'
import { useI18n } from '../../../i18n/i18n'

const stageValues: Array<LeadStage | 'all'> = ['all', 'new', 'contacted', 'replied', 'proposal', 'won', 'lost']
const dueValues: Array<LeadDueFilter | 'all'> = ['all', 'today', 'overdue']

export function LeadsPage() {
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [stage, setStage] = useState<LeadStage | 'all'>('all')
  const [due, setDue] = useState<LeadDueFilter | 'all'>('all')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  const filters = useMemo(
    () => ({
      q: search.trim() || undefined,
      stage: stage === 'all' ? undefined : stage,
      due: due === 'all' ? undefined : due,
    }),
    [due, search, stage],
  )

  const leadsQuery = useQuery({
    queryKey: leadsQueryKeys.list(filters),
    queryFn: () => listLeads(filters),
  })

  const createMutation = useMutation({
    mutationFn: () => createLead({ company_name: 'New company' }),
    onSuccess: (createdLead) => {
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
      setSelectedLead(createdLead)
    },
  })

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">{t('leads.title')}</h1>
          <p className="mt-1 text-sm text-zinc-600">{t('leads.subtitle')}</p>
        </div>
        <button type="button" onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white">{createMutation.isPending ? t('leads.creating') : t('leads.newLead')}</button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('leads.searchPlaceholder')} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm" />
        <select value={stage} onChange={(event) => setStage(event.target.value as LeadStage | 'all')} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm">
          {stageValues.map((option) => <option key={option} value={option}>{t(`leads.filter.stage.${option}`)}</option>)}
        </select>
        <select value={due} onChange={(event) => setDue(event.target.value as LeadDueFilter | 'all')} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm">
          {dueValues.map((option) => <option key={option} value={option}>{t(`leads.filter.due.${option}`)}</option>)}
        </select>
      </div>

      {leadsQuery.isLoading ? (
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">{t('leads.loading')}</div>
      ) : null}
      {leadsQuery.isError ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{t('leads.error')}</div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-200">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="px-4 py-3 font-medium">{t('leads.table.company')}</th><th className="px-4 py-3 font-medium">{t('leads.table.email')}</th><th className="px-4 py-3 font-medium">{t('leads.table.website')}</th><th className="px-4 py-3 font-medium">{t('leads.table.stage')}</th><th className="px-4 py-3 font-medium">{t('leads.table.nextActionAt')}</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 bg-white text-zinc-700">
            {leadsQuery.data?.map((lead) => (
              <tr key={lead.id} onClick={() => setSelectedLead(lead)} className="cursor-pointer transition hover:bg-zinc-50">
                <td className="px-4 py-3 text-zinc-900">{lead.company_name}</td>
                <td className="px-4 py-3">{lead.email ?? '—'}</td>
                <td className="px-4 py-3">{lead.website_domain ?? lead.website ?? '—'}</td>
                <td className="px-4 py-3">{t(`leads.filter.stage.${lead.stage}`)}</td>
                <td className="px-4 py-3">{new Date(lead.next_action_at).toLocaleString()}</td>
              </tr>
            ))}
            {!leadsQuery.data?.length ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm text-zinc-500" colSpan={5}>{t('leads.empty')}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedLead ? <LeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} onLeadChange={setSelectedLead} /> : null}
    </section>
  )
}

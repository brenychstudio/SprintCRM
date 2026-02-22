import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createLead,
  defaultNextForStage,
  leadsQueryKeys,
  listActivities,
  listLeads,
  logActivity,
  updateLead,
} from '../../../features/leads/leadsApi'
import type { Lead, LeadDueFilter, LeadStage, NextAction } from '../../../features/leads/types'
import { isoAtMadridNineAMForDateInput, isoAtMadridNineAMInDays } from '../../../lib/dates'

const stageOptions: Array<{ value: LeadStage | 'all'; label: string }> = [
  { value: 'all', label: 'All stages' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'replied', label: 'Replied' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
]

const dueOptions: Array<{ value: LeadDueFilter | 'all'; label: string }> = [
  { value: 'all', label: 'All due' },
  { value: 'today', label: 'Due today' },
  { value: 'overdue', label: 'Overdue' },
]

const nextActionOptions: NextAction[] = ['follow_up', 'send_proposal', 'request_call', 'nurture']

function LeadDrawer({ lead, onClose, onLeadChange }: { lead: Lead; onClose: () => void; onLeadChange: (lead: Lead) => void }) {
  const queryClient = useQueryClient()
  const [stage, setStage] = useState(lead.stage)
  const [nextAction, setNextAction] = useState(lead.next_action)
  const [nextDate, setNextDate] = useState(lead.next_action_at.slice(0, 10))
  const [notes, setNotes] = useState(lead.notes ?? '')

  useEffect(() => {
    setStage(lead.stage)
    setNextAction(lead.next_action)
    setNextDate(lead.next_action_at.slice(0, 10))
    setNotes(lead.notes ?? '')
  }, [lead])

  const activitiesQuery = useQuery({
    queryKey: leadsQueryKeys.activities(lead.id),
    queryFn: () => listActivities(lead.id),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updatedLead = await updateLead(lead.id, {
        stage,
        next_action: nextAction,
        next_action_at: isoAtMadridNineAMForDateInput(nextDate),
        notes,
      })

      await logActivity({
        lead_id: lead.id,
        type: 'next_action_set',
        meta: { stage, next_action: nextAction, next_action_at: updatedLead.next_action_at },
      })

      return updatedLead
    },
    onSuccess: (updatedLead) => {
      onLeadChange(updatedLead)
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.activities(lead.id) })
    },
  })

  const touchMutation = useMutation({
    mutationFn: async () => {
      const updatedLead = await updateLead(lead.id, { last_touch_at: new Date().toISOString() })
      await logActivity({ lead_id: lead.id, type: 'contacted', channel: 'email' })
      return updatedLead
    },
    onSuccess: (updatedLead) => {
      onLeadChange(updatedLead)
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.activities(lead.id) })
    },
  })

  const moveMutation = useMutation({
    mutationFn: async (targetStage: LeadStage) => {
      const next = defaultNextForStage(targetStage)
      const nextActionAt = isoAtMadridNineAMInDays(next.days)
      const updatedLead = await updateLead(lead.id, {
        stage: targetStage,
        next_action: next.next_action,
        next_action_at: nextActionAt,
        last_touch_at: new Date().toISOString(),
      })

      await logActivity({
        lead_id: lead.id,
        type: 'stage_changed',
        meta: { from: lead.stage, to: targetStage, next_action: next.next_action, next_action_at: nextActionAt },
      })

      return updatedLead
    },
    onSuccess: (updatedLead) => {
      onLeadChange(updatedLead)
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.activities(lead.id) })
    },
  })

  const isBusy = saveMutation.isPending || touchMutation.isPending || moveMutation.isPending

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-900/30">
      <button type="button" aria-label="Close drawer" onClick={onClose} className="h-full flex-1" />
      <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-zinc-200 bg-white p-6 shadow-xl">
        <h2 className="text-xl font-semibold text-zinc-900">{lead.company_name}</h2>
        <p className="mt-1 text-xs text-zinc-500">Lead ID: {lead.id}</p>

        <div className="mt-6 grid gap-4">
          <label className="space-y-1"><span className="text-xs text-zinc-500">Stage</span>
            <select value={stage} onChange={(e) => setStage(e.target.value as LeadStage)} className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm">
              {stageOptions.filter((s) => s.value !== 'all').map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="space-y-1"><span className="text-xs text-zinc-500">Next action</span>
            <select value={nextAction} onChange={(e) => setNextAction(e.target.value as NextAction)} className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm">
              {nextActionOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="space-y-1"><span className="text-xs text-zinc-500">Next date</span>
            <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm" />
          </label>
          <label className="space-y-1"><span className="text-xs text-zinc-500">Notes</span>
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => touchMutation.mutate()} disabled={isBusy} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm">Log touch</button>
          <button type="button" onClick={() => saveMutation.mutate()} disabled={isBusy} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white">Save</button>
          {(['contacted', 'replied', 'proposal'] as LeadStage[]).map((targetStage) => (
            <button key={targetStage} type="button" onClick={() => moveMutation.mutate(targetStage)} disabled={isBusy} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm capitalize">{targetStage}</button>
          ))}
        </div>

        <div className="mt-8">
          <h3 className="text-sm font-semibold text-zinc-900">Activity timeline</h3>
          <ul className="mt-3 space-y-2">
            {activitiesQuery.data?.map((activity) => (
              <li key={activity.id} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm">
                <p className="font-medium text-zinc-800">{activity.type}</p>
                <p className="text-xs text-zinc-500">{new Date(activity.at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}

export function LeadsPage() {
  const queryClient = useQueryClient()
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
          <h1 className="text-2xl font-semibold text-zinc-900">Leads</h1>
          <p className="mt-1 text-sm text-zinc-600">Search, filter, and keep every next action disciplined.</p>
        </div>
        <button type="button" onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white">{createMutation.isPending ? 'Creating…' : 'New lead'}</button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search company, email, website" className="rounded-xl border border-zinc-200 px-3 py-2 text-sm" />
        <select value={stage} onChange={(event) => setStage(event.target.value as LeadStage | 'all')} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm">
          {stageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={due} onChange={(event) => setDue(event.target.value as LeadDueFilter | 'all')} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm">
          {dueOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-200">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="px-4 py-3 font-medium">Company</th><th className="px-4 py-3 font-medium">Email</th><th className="px-4 py-3 font-medium">Website</th><th className="px-4 py-3 font-medium">Stage</th><th className="px-4 py-3 font-medium">Next action at</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 bg-white text-zinc-700">
            {leadsQuery.data?.map((lead) => (
              <tr key={lead.id} onClick={() => setSelectedLead(lead)} className="cursor-pointer transition hover:bg-zinc-50">
                <td className="px-4 py-3 text-zinc-900">{lead.company_name}</td>
                <td className="px-4 py-3">{lead.email ?? '—'}</td>
                <td className="px-4 py-3">{lead.website_domain ?? lead.website ?? '—'}</td>
                <td className="px-4 py-3 capitalize">{lead.stage}</td>
                <td className="px-4 py-3">{new Date(lead.next_action_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedLead ? <LeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} onLeadChange={setSelectedLead} /> : null}
    </section>
  )
}

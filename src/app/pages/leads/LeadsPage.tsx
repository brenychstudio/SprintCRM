import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LeadDrawer } from '../../features/leads/LeadDrawer'
import { BulkActionsBar } from '../../features/leads/BulkActionsBar'
import { createLead, leadsQueryKeys, listLeads } from '../../../features/leads/leadsApi'
import type { Lead, LeadDueFilter, LeadStage } from '../../../features/leads/types'
import { useI18n } from '../../../i18n/i18n'
import { endOfTodayISO, startOfTodayISO } from '../../../lib/dates'

const stageValues: Array<LeadStage | 'all'> = ['all', 'new', 'contacted', 'replied', 'proposal', 'won', 'lost']
const dueValues: Array<LeadDueFilter | 'all'> = ['all', 'today', 'overdue']
const smartViewValues = ['all', 'overdue', 'active_contacts', 'proposal', 'new', 'archived'] as const
type SmartView = (typeof smartViewValues)[number]

type SavedLeadView = {
  id: string
  name: string
  smartView: SmartView
  search: string
  stage: LeadStage | 'all'
  due: LeadDueFilter | 'all'
  niche: string
  city: string
}

const SAVED_VIEWS_KEY = 'leads.smartViews.v1'

function loadSavedViews(): SavedLeadView[] {
  try {
    const raw = localStorage.getItem(SAVED_VIEWS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedLeadView[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveSavedViews(views: SavedLeadView[]) {
  try {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views))
  } catch {
    // ignore
  }
}

export function LeadsPage() {
  const queryClient = useQueryClient()
  const { t } = useI18n()

  const [search, setSearch] = useState('')
  const [stage, setStage] = useState<LeadStage | 'all'>('all')
  const [due, setDue] = useState<LeadDueFilter | 'all'>('all')
  const [niche, setNiche] = useState('__all')
  const [city, setCity] = useState('__all')
  const [smartView, setSmartView] = useState<SmartView>('all')

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [savedViews, setSavedViews] = useState<SavedLeadView[]>(() => loadSavedViews())
  const [selectedSavedViewId, setSelectedSavedViewId] = useState('')

  const leadsQuery = useQuery({
    queryKey: leadsQueryKeys.list({ scope: 'leads-smart-views' }),
    queryFn: () => listLeads({}),
  })

  useEffect(() => {
    saveSavedViews(savedViews)
  }, [savedViews])

  const nicheOptions = useMemo(() => {
    const values = new Set<string>()
    for (const lead of leadsQuery.data ?? []) {
      const v = lead.niche?.trim()
      if (v) values.add(v)
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }, [leadsQuery.data])

  const cityOptions = useMemo(() => {
    const values = new Set<string>()
    for (const lead of leadsQuery.data ?? []) {
      const v = lead.country_city?.trim()
      if (v) values.add(v)
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }, [leadsQuery.data])

  const startToday = useMemo(() => new Date(startOfTodayISO()).getTime(), [])
  const endToday = useMemo(() => new Date(endOfTodayISO()).getTime(), [])

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase()

    return (leadsQuery.data ?? []).filter((lead) => {
      const nextAt = new Date(lead.next_action_at).getTime()
      const leadNiche = lead.niche?.trim() ?? ''
      const leadCity = lead.country_city?.trim() ?? ''

      // Safety polish:
      // archived leads are hidden from normal work views unless Archived smart view is selected
      if (smartView === 'archived') {
        if (lead.status !== 'archived') return false
      } else {
        if (lead.status !== 'active') return false
      }

      // Smart view base
      if (smartView === 'overdue' && !(nextAt < startToday)) return false
      if (smartView === 'active_contacts' && !(['contacted', 'replied', 'proposal'] as LeadStage[]).includes(lead.stage)) return false
      if (smartView === 'proposal' && lead.stage !== 'proposal') return false
      if (smartView === 'new' && lead.stage !== 'new') return false

      // Search
      const matchesSearch =
        !q ||
        [lead.company_name, lead.contact_name ?? '', lead.email ?? '', lead.website_domain ?? lead.website ?? '', lead.country_city ?? '', lead.niche ?? '']
          .join(' ')
          .toLowerCase()
          .includes(q)

      if (!matchesSearch) return false

      // Manual filters refine the view
      if (stage !== 'all' && lead.stage !== stage) return false
      if (due === 'today' && !(nextAt >= startToday && nextAt <= endToday)) return false
      if (due === 'overdue' && !(nextAt < startToday)) return false
      if (niche === '__unspecified' && leadNiche) return false
      if (niche !== '__all' && niche !== '__unspecified' && leadNiche !== niche) return false
      if (city === '__unspecified' && leadCity) return false
      if (city !== '__all' && city !== '__unspecified' && leadCity !== city) return false

      return true
    })
  }, [city, due, endToday, leadsQuery.data, niche, search, smartView, stage, startToday])

  const leadsById = useMemo(() => {
    const map: Record<string, Lead> = {}
    for (const lead of filteredLeads) map[lead.id] = lead
    return map
  }, [filteredLeads])

  const allIds = useMemo(() => filteredLeads.map((l) => l.id), [filteredLeads])

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => leadsById[id]))
  }, [leadsById])

  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id))
  const someSelected = selectedIds.length > 0 && !allSelected

  const selectAllRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : allIds)
  }

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const clearSelection = () => setSelectedIds([])

  const createMutation = useMutation({
    mutationFn: () => createLead({ company_name: 'New company' }),
    onSuccess: (createdLead) => {
      queryClient.invalidateQueries({ queryKey: leadsQueryKeys.all })
      setSelectedLead(createdLead)
    },
  })

  const summary = useMemo(() => {
    let overdue = 0
    let activeContacts = 0

    for (const lead of filteredLeads) {
      if (new Date(lead.next_action_at).getTime() < Date.now()) overdue++
      if (lead.status === 'active' && ['contacted', 'replied', 'proposal'].includes(lead.stage)) activeContacts++
    }

    return {
      total: filteredLeads.length,
      overdue,
      activeContacts,
    }
  }, [filteredLeads])

  function applySmartView(next: SmartView) {
    setSmartView(next)
    setSelectedSavedViewId('')

    if (next === 'overdue') {
      setDue('all')
      setStage('all')
    }
    if (next === 'active_contacts') {
      setStage('all')
    }
    if (next === 'proposal') {
      setStage('all')
    }
    if (next === 'new') {
      setStage('all')
    }
    if (next === 'archived') {
      setDue('all')
      setStage('all')
    }
  }

  function applySavedView(view: SavedLeadView) {
    setSelectedSavedViewId(view.id)
    setSmartView(view.smartView)
    setSearch(view.search)
    setStage(view.stage)
    setDue(view.due)
    setNiche(view.niche)
    setCity(view.city)
  }

  function saveCurrentView() {
    const name = window.prompt(t('leads.smartViews.namePrompt'))
    if (!name?.trim()) return

    const nextView: SavedLeadView = {
      id: `view_${Math.random().toString(16).slice(2)}`,
      name: name.trim(),
      smartView,
      search,
      stage,
      due,
      niche,
      city,
    }

    setSavedViews((prev) => [nextView, ...prev].slice(0, 20))
    setSelectedSavedViewId(nextView.id)
  }

  function deleteSelectedView() {
    if (!selectedSavedViewId) return
    const ok = window.confirm(t('leads.smartViews.deleteConfirm'))
    if (!ok) return

    setSavedViews((prev) => prev.filter((v) => v.id !== selectedSavedViewId))
    setSelectedSavedViewId('')
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">{t('leads.title')}</h1>
          <p className="mt-1 text-sm text-zinc-600">{t('leads.subtitle')}</p>
        </div>

        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white"
        >
          {createMutation.isPending ? t('leads.creating') : t('leads.newLead')}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('reports.kpi.active')}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{summary.total}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('activeContacts.kpi.total')}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{summary.activeContacts}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('activeContacts.kpi.overdue')}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{summary.overdue}</div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-zinc-500">{t('leads.smartViews.title')}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {smartViewValues.map((view) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => applySmartView(view)}
                  className={`rounded-xl border px-3 py-2 text-sm transition ${
                    smartView === view
                      ? 'border-zinc-200 bg-zinc-100 text-zinc-900'
                      : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'
                  }`}
                >
                  {t(`leads.smartViews.${view}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px]">
              <div className="mb-1 text-xs text-zinc-500">{t('leads.smartViews.savedLabel')}</div>
              <select
                value={selectedSavedViewId}
                onChange={(e) => {
                  const id = e.target.value
                  setSelectedSavedViewId(id)
                  const view = savedViews.find((v) => v.id === id)
                  if (view) applySavedView(view)
                }}
                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
              >
                <option value="">{t('leads.smartViews.selectPlaceholder')}</option>
                {savedViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={saveCurrentView}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              {t('leads.smartViews.save')}
            </button>

            <button
              type="button"
              onClick={deleteSelectedView}
              disabled={!selectedSavedViewId}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {t('leads.smartViews.delete')}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.4fr)_180px_180px_220px_220px]">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('leads.searchPlaceholder')}
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"
        />

        <select
          value={stage}
          onChange={(event) => setStage(event.target.value as LeadStage | 'all')}
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"
        >
          {stageValues.map((option) => (
            <option key={option} value={option}>
              {t(`leads.filter.stage.${option}`)}
            </option>
          ))}
        </select>

        <select
          value={due}
          onChange={(event) => setDue(event.target.value as LeadDueFilter | 'all')}
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"
        >
          {dueValues.map((option) => (
            <option key={option} value={option}>
              {t(`leads.filter.due.${option}`)}
            </option>
          ))}
        </select>

        <select
          value={niche}
          onChange={(event) => setNiche(event.target.value)}
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"
        >
          <option value="__all">{t('leads.filter.nicheAll')}</option>
          <option value="__unspecified">{t('leads.filter.nicheUnspecified')}</option>
          {nicheOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <select
          value={city}
          onChange={(event) => setCity(event.target.value)}
          className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"
        >
          <option value="__all">{t('leads.filter.cityAll')}</option>
          <option value="__unspecified">{t('leads.filter.cityUnspecified')}</option>
          {cityOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      {selectedIds.length ? <div className="mt-5" /> : null}
      {selectedIds.length ? <BulkActionsBar selectedIds={selectedIds} leadsById={leadsById} onClear={clearSelection} /> : null}

      {leadsQuery.isLoading ? (
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">{t('leads.loading')}</div>
      ) : null}

      {leadsQuery.isError ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{t('leads.error')}</div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="w-10 px-4 py-3">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-zinc-300"
                  aria-label="Select all"
                />
              </th>
              <th className="px-4 py-3 font-medium">{t('leads.table.company')}</th>
              <th className="px-4 py-3 font-medium">{t('leads.table.stage')}</th>
              <th className="px-4 py-3 font-medium">{t('drawer.nextAction')}</th>
              <th className="px-4 py-3 font-medium">{t('leads.table.nextActionAt')}</th>
              <th className="px-4 py-3 font-medium">{t('activeContacts.table.lastTouch')}</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-200 bg-white text-zinc-700">
            {filteredLeads.map((lead) => {
              const checked = selectedIds.includes(lead.id)
              const overdue = new Date(lead.next_action_at).getTime() < Date.now()

              return (
                <tr
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  className={`cursor-pointer transition hover:bg-zinc-50 ${checked ? 'bg-zinc-50' : ''}`}
                >
                  <td className="px-4 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(lead.id)}
                      className="h-4 w-4 rounded border-zinc-300"
                      aria-label="Select lead"
                    />
                  </td>

                  <td className="px-4 py-3 align-top">
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-zinc-900">{lead.company_name}</div>
                      {lead.status === 'archived' ? (
                        <span className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600">
                          {t('leads.smartViews.archived')}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-1 space-y-1 text-xs text-zinc-500">
                      {lead.email ? <div>{lead.email}</div> : null}
                      {lead.website_domain || lead.website ? <div>{lead.website_domain ?? lead.website}</div> : null}
                      {lead.niche ? <div>{lead.niche}</div> : null}
                      {lead.country_city ? <div>{lead.country_city}</div> : null}
                    </div>
                  </td>

                  <td className="px-4 py-3 align-top">
                    <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-700">
                      {t(`leads.filter.stage.${lead.stage}`)}
                    </span>
                  </td>

                  <td className="px-4 py-3 align-top text-zinc-700">{t(`action.${lead.next_action}`)}</td>

                  <td className="px-4 py-3 align-top">
                    <div className={overdue ? 'text-red-700' : 'text-zinc-700'}>
                      {new Date(lead.next_action_at).toLocaleString()}
                    </div>
                    {overdue ? <div className="mt-1 text-xs text-red-700">{t('activeContacts.table.overdue')}</div> : null}
                  </td>

                  <td className="px-4 py-3 align-top">
                    {lead.last_touch_at ? new Date(lead.last_touch_at).toLocaleString() : '—'}
                  </td>
                </tr>
              )
            })}

            {!filteredLeads.length ? (
              <tr>
                <td className="px-4 py-8 text-center text-sm text-zinc-500" colSpan={6}>
                  {t('leads.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedLead ? <LeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} onLeadChange={setSelectedLead} /> : null}
    </section>
  )
}
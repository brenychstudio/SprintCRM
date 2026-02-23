import { endOfTodayISO, startOfTodayISO } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import type {
  Activity,
  ActivityChannel,
  ActivityType,
  CreateLeadInput,
  Lead,
  LeadDueFilter,
  LeadStage,
  NextAction,
  UpdateLeadInput,
} from './types'

export type LeadFilters = {
  q?: string
  stage?: LeadStage
  due?: LeadDueFilter
}

export const leadsQueryKeys = {
  all: ['leads'] as const,
  list: (filters: LeadFilters) => ['leads', filters] as const,
  activities: (leadId: string) => ['activities', leadId] as const,
}

export async function listLeads(filters: LeadFilters = {}): Promise<Lead[]> {
  let query = supabase.from('leads').select('*').order('next_action_at', { ascending: true })

  const q = filters.q?.trim()
  if (q) {
    query = query.or([
      `company_name.ilike.%${q}%`,
      `contact_name.ilike.%${q}%`,
      `email.ilike.%${q}%`,
      `website_domain.ilike.%${q}%`,
    ].join(','))
  }

  if (filters.stage) query = query.eq('stage', filters.stage)
  if (filters.due === 'today') query = query.gte('next_action_at', startOfTodayISO()).lte('next_action_at', endOfTodayISO())
  if (filters.due === 'overdue') query = query.lt('next_action_at', startOfTodayISO())

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Lead[]
}

export async function createLead(input: CreateLeadInput): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .insert({
      company_name: input.company_name,
      website: input.website,
      website_domain: input.website_domain,
      niche: input.niche,
      country_city: input.country_city,
      contact_name: input.contact_name,
      email: input.email,
      phone: input.phone,
      source_file: input.source_file,
      stage: input.stage,
      status: input.status,
      last_touch_at: input.last_touch_at,
      next_action: input.next_action,
      next_action_at: input.next_action_at,
      notes: input.notes,
      revenue: input.revenue,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as Lead
}

export async function updateLead(id: string, patch: UpdateLeadInput): Promise<Lead> {
  const { data, error } = await supabase.from('leads').update(patch).eq('id', id).select('*').single()
  if (error) throw error
  return data as Lead
}

export async function listActivities(leadId: string): Promise<Activity[]> {
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('lead_id', leadId)
    .order('at', { ascending: false })
    .limit(50)

  if (error) throw error
  return (data ?? []) as Activity[]
}

export async function logActivity(input: {
  lead_id: string
  type: ActivityType
  channel?: ActivityChannel
  meta?: Record<string, unknown>
}): Promise<Activity> {
  const { data, error } = await supabase
    .from('activities')
    .insert({ lead_id: input.lead_id, type: input.type, channel: input.channel, meta: input.meta ?? {} })
    .select('*')
    .single()

  if (error) throw error
  return data as Activity
}

export function defaultNextForStage(stage: LeadStage): { next_action: NextAction; days: number } {
  if (stage === 'contacted') return { next_action: 'follow_up', days: 3 }
  if (stage === 'replied') return { next_action: 'send_proposal', days: 2 }
  if (stage === 'proposal') return { next_action: 'follow_up', days: 2 }
  return { next_action: 'follow_up', days: 3 }
}

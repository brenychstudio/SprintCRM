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
import { cleanNullable, deriveWebsiteDomain, normalizeEmail, normalizePhone } from '../../lib/normalize'

export type LeadFilters = {
  scope?: string
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
  const website = cleanNullable(input.website)
  const website_domain = deriveWebsiteDomain(website, input.website_domain)
  const email = normalizeEmail(input.email)
  const phone = normalizePhone(input.phone)

  const { data, error } = await supabase
    .from('leads')
    .insert({
      company_name: input.company_name,
      website,
      website_domain,
      niche: cleanNullable(input.niche),
      country_city: cleanNullable(input.country_city),
      contact_name: cleanNullable(input.contact_name),
      email,
      phone,
      source_file: cleanNullable(input.source_file),
      stage: input.stage,
      status: input.status,
      last_touch_at: input.last_touch_at,
      next_action: input.next_action,
      next_action_at: input.next_action_at,
      notes: cleanNullable(input.notes),
      revenue: input.revenue ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as Lead
}

export async function updateLead(id: string, patch: UpdateLeadInput): Promise<Lead> {
  const nextPatch: UpdateLeadInput = { ...patch }

  if ('email' in patch) nextPatch.email = normalizeEmail(patch.email)
  if ('phone' in patch) nextPatch.phone = normalizePhone(patch.phone)

  if ('website' in patch || 'website_domain' in patch) {
    const website = 'website' in patch ? cleanNullable(patch.website) : undefined
    const domain = 'website_domain' in patch ? patch.website_domain : undefined

    nextPatch.website = 'website' in patch ? website : patch.website
    nextPatch.website_domain = deriveWebsiteDomain(website ?? null, domain ?? patch.website_domain)
  }

  const { data, error } = await supabase.from('leads').update(nextPatch).eq('id', id).select('*').single()
  if (error) throw error
  return data as Lead
}

export async function deleteLeadPermanently(id: string): Promise<void> {
  const { error: activitiesError } = await supabase.from('activities').delete().eq('lead_id', id)
  if (activitiesError) throw activitiesError

  const { error: leadError } = await supabase.from('leads').delete().eq('id', id)
  if (leadError) throw leadError
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

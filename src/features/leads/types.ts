export type LeadStage = 'new' | 'contacted' | 'replied' | 'proposal' | 'won' | 'lost'
export type LeadStatus = 'active' | 'archived'
export type NextAction = 'follow_up' | 'send_proposal' | 'request_call' | 'nurture'

export type ActivityType =
  | 'imported'
  | 'contacted'
  | 'replied'
  | 'proposal_sent'
  | 'won'
  | 'lost'
  | 'note'
  | 'stage_changed'
  | 'next_action_set'

export type ActivityChannel = 'email' | 'ig' | 'linkedin' | 'other'

export type Lead = {
  id: string
  org_id: string
  owner: string
  created_by: string
  company_name: string
  website: string | null
  website_domain: string | null
  niche: string | null
  country_city: string | null
  contact_name: string | null
  email: string | null
  phone: string | null
  source_file: string | null
  stage: LeadStage
  status: LeadStatus
  last_touch_at: string
  next_action: NextAction
  next_action_at: string
  notes: string | null
  revenue: number | null
  email_norm: string | null
  website_domain_norm: string | null
  phone_norm: string | null
  created_at: string
  updated_at: string
}

export type Activity = {
  id: string
  org_id: string
  owner: string
  lead_id: string
  type: ActivityType
  channel: ActivityChannel | null
  at: string
  meta: Record<string, unknown>
}

export type CreateLeadInput = Pick<Lead, 'company_name'> &
  Partial<
    Pick<
      Lead,
      | 'website'
      | 'website_domain'
      | 'niche'
      | 'country_city'
      | 'contact_name'
      | 'email'
      | 'phone'
      | 'source_file'
      | 'stage'
      | 'status'
      | 'last_touch_at'
      | 'next_action'
      | 'next_action_at'
      | 'notes'
      | 'revenue'
    >
  >

export type UpdateLeadInput = Partial<
  Pick<
    Lead,
    | 'company_name'
    | 'website'
    | 'website_domain'
    | 'niche'
    | 'country_city'
    | 'contact_name'
    | 'email'
    | 'phone'
    | 'source_file'
    | 'stage'
    | 'status'
    | 'last_touch_at'
    | 'next_action'
    | 'next_action_at'
    | 'notes'
    | 'revenue'
  >
>

export type LeadDueFilter = 'today' | 'overdue'

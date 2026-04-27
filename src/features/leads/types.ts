export type LeadStage = 'new' | 'contacted' | 'replied' | 'proposal' | 'won' | 'lost'
export type LeadStatus = 'active' | 'archived'
export type NextAction = 'follow_up' | 'send_proposal' | 'request_call' | 'nurture'
export type OutreachChannel = 'email' | 'linkedin' | 'ig' | 'other'
export type OutreachLanguage = 'en' | 'uk' | 'es' | 'ru'
export type OutreachVariant = 'short' | 'standard' | 'premium'
export type ReplyStatus = 'not_sent' | 'sent' | 'no_reply' | 'replied' | 'positive' | 'negative'

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
  | 'ai_draft_generated'
  | 'ai_draft_applied'
  | 'ai_draft_copied'
  | 'outreach_sent'
  | 'followup_scheduled'
  | 'reply_marked'
  | 'manual_edit'

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
  preferred_channel: OutreachChannel | null
  language: OutreachLanguage | null
  service_interest: string | null
  offer_type: string | null
  observed_issue: string | null
  reply_status: ReplyStatus | null
  current_outreach_generation_id: string | null
  current_outreach_subject: string | null
  current_outreach_body: string | null
  current_outreach_variant: OutreachVariant | null
  current_outreach_channel: OutreachChannel | null
  current_outreach_personalization_notes: string | null
  outreach_generated_at: string | null
  outreach_edited_manually: boolean
  sent_at: string | null
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
      | 'preferred_channel'
      | 'language'
      | 'service_interest'
      | 'offer_type'
      | 'observed_issue'
      | 'reply_status'
      | 'current_outreach_generation_id'
      | 'current_outreach_subject'
      | 'current_outreach_body'
      | 'current_outreach_variant'
      | 'current_outreach_channel'
      | 'current_outreach_personalization_notes'
      | 'outreach_generated_at'
      | 'outreach_edited_manually'
      | 'sent_at'
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
    | 'preferred_channel'
    | 'language'
    | 'service_interest'
    | 'offer_type'
    | 'observed_issue'
    | 'reply_status'
    | 'current_outreach_generation_id'
    | 'current_outreach_subject'
    | 'current_outreach_body'
    | 'current_outreach_variant'
    | 'current_outreach_channel'
    | 'current_outreach_personalization_notes'
    | 'outreach_generated_at'
    | 'outreach_edited_manually'
    | 'sent_at'
  >
>

export type LeadDueFilter = 'today' | 'overdue'

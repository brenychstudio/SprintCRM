import type { Json } from '../../lib/supabase/database.types'
import type { Lead } from '../leads/types'

export const campaignStatuses = ['draft', 'active', 'paused', 'completed', 'archived'] as const
export type CampaignStatus = (typeof campaignStatuses)[number]
export const campaignMemberStatuses = ['queued', 'researching', 'research_ready', 'draft_ready', 'needs_review', 'approved', 'provider_draft', 'sent', 'replied', 'followup_due', 'skipped', 'suppressed', 'failed'] as const
export type CampaignMemberStatus = (typeof campaignMemberStatuses)[number]
export type OutreachChannel = 'email' | 'linkedin' | 'ig' | 'other'
export type OutreachLanguage = 'en' | 'uk' | 'es' | 'ru'
export type MessageStatus = 'draft' | 'needs_review' | 'approved' | 'provider_draft' | 'sent' | 'failed' | 'cancelled'

export type Campaign = { id: string; organization_id: string; name: string; description: string | null; status: CampaignStatus; target_segment: string | null; offer_summary: string | null; default_channel: OutreachChannel; default_language: OutreachLanguage; tone: string | null; proof_context: string | null; created_at: string; updated_at: string }
export type CampaignMember = { id: string; organization_id: string; campaign_id: string; lead_id: string; status: CampaignMemberStatus; skip_reason: string | null; last_error: string | null; created_at: string; updated_at: string }
export type ResearchEvidence = { url: string; title?: string; claim?: string; note?: string; checked_at?: string }
export type ResearchSnapshot = { id: string; campaign_member_id: string; version: number; observed_opportunity: string | null; recommended_offer: string | null; recommended_case: string | null; evidence: ResearchEvidence[]; confidence: number | null; warnings: string[]; created_at: string }
export type OutboundMessage = { id: string; campaign_member_id: string; version: number; source: 'manual' | 'template' | 'ai'; ai_generation_id: string | null; channel: OutreachChannel; language: OutreachLanguage; subject: string | null; body: string; status: MessageStatus; research_snapshot_id: string | null; approved_by: string | null; approved_at: string | null; created_at: string; updated_at: string }
export type CampaignMemberWithLead = CampaignMember & { lead: Lead | null; latestResearch: ResearchSnapshot | null; latestMessage: OutboundMessage | null }
export type CampaignInput = { name: string; description?: string; target_segment?: string; offer_summary?: string; default_channel: OutreachChannel; default_language: OutreachLanguage; tone?: string; proof_context?: string; status?: CampaignStatus }
export type EligibilityOutcome = 'eligible' | 'needs_information' | 'suppressed' | 'already_added' | 'archived' | 'ineligible'
export type EligibilityResult = { lead_id: string; outcome: EligibilityOutcome; reason: string | null; campaign_member_id: string | null }
export type ActiveSuppression = { subject_type: 'lead' | 'email' | 'domain'; subject_value_normalized: string }
export type AiRuntimeProbe = {
  id: string
  generation_status: 'pending' | 'completed' | 'failed'
  model_name: string | null
  total_tokens: number | null
  duration_ms: number | null
  estimated_cost_usd: number | null
  request_id: string | null
  created_at: string
}
export type AiRuntimeProbeResult = {
  ok: true
  job_id: string
  status: 'completed'
  provider: 'openai'
  model: string
  schema_version: 'runtime_probe_v1'
  usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number; total_tokens: number }
  cost: { estimated_usd: number | null; status: 'not_configured' }
  duration_ms: number
}
export type AiResearchJob = { id: string; generation_status: 'pending' | 'completed' | 'failed'; model_name: string | null; total_tokens: number | null; duration_ms: number | null; request_id: string | null; created_at: string; error_code: string | null; output_payload: Json | null }
export type AiResearchResult = { ok: true; job_id: string; research_snapshot_id: string; research_version: number; status: 'completed'; provider: 'openai'; model: string; schema_version: 'research_v2'; usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number; total_tokens: number }; cost: { estimated_usd: number | null; status: 'not_configured' }; duration_ms: number; source_count: number }
export type AiDraftJob = { id: string; generation_status: 'pending' | 'completed' | 'failed'; model_name: string | null; total_tokens: number | null; duration_ms: number | null; request_id: string | null; created_at: string; error_code: string | null }
export type AiDraftResult = { ok: true; job_id: string; request_id: string; status: 'completed'; provider: 'openai'; model: string; schema_version: 'draft_v1'; message_version: number; research_version: number; usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number; total_tokens: number }; cost: { estimated_usd: number | null; status: 'not_configured' }; duration_ms: number }
export type ResearchInput = { observed_opportunity: string; recommended_offer: string; recommended_case: string; evidence: ResearchEvidence[]; confidence: number | null; warnings: string[] }
export type MessageInput = { subject: string; body: string; channel: OutreachChannel; language: OutreachLanguage; research_snapshot_id: string | null }
export type CampaignProgress = Record<'toPrepare' | 'needsReview' | 'ready' | 'sent' | 'needsAttention', number>
export type JsonValue = Json

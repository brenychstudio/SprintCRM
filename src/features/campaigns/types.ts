import type { Json } from '../../lib/supabase/database.types'
import type { Lead } from '../leads/types'

export const campaignStatuses = ['draft', 'active', 'paused', 'completed', 'archived'] as const
export type CampaignStatus = (typeof campaignStatuses)[number]
export const campaignMemberStatuses = ['queued', 'researching', 'research_ready', 'draft_ready', 'needs_review', 'approved', 'provider_draft', 'sent', 'replied', 'followup_due', 'skipped', 'suppressed', 'failed'] as const
export type CampaignMemberStatus = (typeof campaignMemberStatuses)[number]
export type OutreachChannel = 'email' | 'linkedin' | 'ig' | 'other'
export type OutreachLanguage = 'en' | 'uk' | 'es' | 'ru'
export type MessageStatus = 'draft' | 'needs_review' | 'approved' | 'provider_draft' | 'sent' | 'failed' | 'cancelled'

export type Campaign = { id: string; organization_id: string; name: string; description: string | null; status: CampaignStatus; target_segment: string | null; offer_summary: string | null; default_channel: OutreachChannel; default_language: OutreachLanguage; tone: string | null; created_at: string; updated_at: string }
export type CampaignMember = { id: string; organization_id: string; campaign_id: string; lead_id: string; status: CampaignMemberStatus; skip_reason: string | null; last_error: string | null; created_at: string; updated_at: string }
export type ResearchEvidence = { url: string; title?: string; claim: string; checked_at?: string }
export type ResearchSnapshot = { id: string; campaign_member_id: string; version: number; observed_opportunity: string | null; recommended_offer: string | null; recommended_case: string | null; evidence: ResearchEvidence[]; confidence: number | null; warnings: string[]; created_at: string }
export type OutboundMessage = { id: string; campaign_member_id: string; version: number; channel: OutreachChannel; language: OutreachLanguage; subject: string | null; body: string; status: MessageStatus; research_snapshot_id: string | null; approved_by: string | null; approved_at: string | null; created_at: string; updated_at: string }
export type CampaignMemberWithLead = CampaignMember & { lead: Lead | null; latestResearch: ResearchSnapshot | null; latestMessage: OutboundMessage | null }
export type CampaignInput = { name: string; description?: string; target_segment?: string; offer_summary?: string; default_channel: OutreachChannel; default_language: OutreachLanguage; tone?: string; status?: CampaignStatus }
export type EligibilityOutcome = 'eligible' | 'needs_information' | 'suppressed' | 'already_added' | 'archived' | 'ineligible'
export type EligibilityResult = { lead_id: string; outcome: EligibilityOutcome; reason: string | null; campaign_member_id: string | null }
export type ResearchInput = { observed_opportunity: string; recommended_offer: string; recommended_case: string; evidence: ResearchEvidence[]; confidence: number | null; warnings: string[] }
export type MessageInput = { subject: string; body: string; channel: OutreachChannel; language: OutreachLanguage; research_snapshot_id: string | null }
export type CampaignProgress = Record<'toPrepare' | 'needsReview' | 'ready' | 'sent' | 'needsAttention', number>
export type JsonValue = Json

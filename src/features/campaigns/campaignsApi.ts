import { supabase } from '../../lib/supabase'
import type { Json } from '../../lib/supabase/database.types'
import { listLeads } from '../leads/leadsApi'
import type { Lead } from '../leads/types'
import type { Campaign, CampaignInput, CampaignMember, CampaignMemberWithLead, EligibilityResult, MessageInput, OutboundMessage, ResearchInput, ResearchSnapshot } from './types'

const asCampaign = (value: unknown) => value as Campaign
const asMember = (value: unknown) => value as CampaignMember
const asMessage = (value: unknown) => value as OutboundMessage
const asResearch = (value: unknown) => value as ResearchSnapshot

export const campaignQueryKeys = {
  all: ['campaigns'] as const,
  list: () => ['campaigns', 'list'] as const,
  detail: (campaignId: string) => ['campaigns', campaignId] as const,
  members: (campaignId: string) => ['campaigns', campaignId, 'members'] as const,
  workspace: (campaignId: string, memberId: string) => ['campaigns', campaignId, 'member', memberId] as const,
  leadSummary: (leadId: string) => ['campaigns', 'lead', leadId] as const,
  tasks: () => ['campaigns', 'tasks'] as const,
}
function fail(error: { code?: string; message?: string } | null, fallback: string): never {
  if (error?.code === '23505') throw new Error('This lead is already in the campaign.')
  if (error?.code === 'P0002') throw new Error('The requested campaign item was not found or is unavailable.')
  if (error?.code === '22023') throw new Error(error.message || fallback)
  throw new Error(fallback)
}

export async function listCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase.from('campaigns').select('*').order('updated_at', { ascending: false })
  if (error) fail(error, 'Unable to load campaigns.')
  return (data ?? []).map(asCampaign)
}
export async function getCampaign(id: string): Promise<Campaign> {
  const { data, error } = await supabase.from('campaigns').select('*').eq('id', id).single()
  if (error) fail(error, 'Campaign not found.')
  return asCampaign(data)
}
export async function createCampaign(input: CampaignInput): Promise<Campaign> {
  const { data, error } = await supabase.rpc('create_manual_campaign', {
    p_name: input.name.trim(), p_description: input.description ?? '', p_target_segment: input.target_segment ?? '',
    p_offer_summary: input.offer_summary ?? '', p_default_channel: input.default_channel,
    p_default_language: input.default_language, p_tone: input.tone ?? '',
  })
  if (error) fail(error, 'Unable to create campaign.')
  return asCampaign(data)
}
export async function updateCampaign(id: string, input: CampaignInput): Promise<Campaign> {
  const { data, error } = await supabase.rpc('update_manual_campaign', {
    p_campaign_id: id, p_name: input.name.trim(), p_description: input.description ?? '',
    p_target_segment: input.target_segment ?? '', p_offer_summary: input.offer_summary ?? '',
    p_default_channel: input.default_channel, p_default_language: input.default_language,
    p_tone: input.tone ?? '', p_status: input.status ?? 'draft',
  })
  if (error) fail(error, 'Unable to update campaign.')
  return asCampaign(data)
}
export async function listCampaignMembers(campaignId: string): Promise<CampaignMember[]> {
  const { data, error } = await supabase.from('campaign_members').select('*').eq('campaign_id', campaignId).order('updated_at', { ascending: true })
  if (error) fail(error, 'Unable to load campaign members.')
  return (data ?? []).map(asMember)
}
export async function addCampaignMembers(campaignId: string, leadIds: string[]): Promise<EligibilityResult[]> {
  if (!leadIds.length) return []
  const { data, error } = await supabase.rpc('add_campaign_members', { p_campaign_id: campaignId, p_lead_ids: leadIds })
  if (error) fail(error, 'Unable to add selected leads.')
  return (data ?? []) as EligibilityResult[]
}
export async function listResearchSnapshots(memberId: string): Promise<ResearchSnapshot[]> {
  const { data, error } = await supabase.from('research_snapshots').select('*').eq('campaign_member_id', memberId).order('version', { ascending: false })
  if (error) fail(error, 'Unable to load research.')
  return (data ?? []).map(asResearch)
}
export async function saveResearch(memberId: string, input: ResearchInput): Promise<ResearchSnapshot> {
  const { data, error } = await supabase.rpc('save_manual_research_snapshot', {
    p_campaign_member_id: memberId, p_observed_opportunity: input.observed_opportunity, p_recommended_offer: input.recommended_offer,
    p_recommended_case: input.recommended_case, p_evidence: input.evidence as unknown as Json,
    p_confidence: input.confidence, p_warnings: input.warnings as unknown as Json,
  })
  if (error) fail(error, 'Unable to save research.')
  return asResearch(data)
}
export async function listOutboundMessages(memberId: string): Promise<OutboundMessage[]> {
  const { data, error } = await supabase.from('outbound_messages').select('*').eq('campaign_member_id', memberId).order('version', { ascending: false })
  if (error) fail(error, 'Unable to load messages.')
  return (data ?? []).map(asMessage)
}
export async function saveMessage(memberId: string, input: MessageInput, submission: 'draft' | 'needs_review'): Promise<OutboundMessage> {
  const { data, error } = await supabase.rpc('save_manual_outbound_message', {
    p_campaign_member_id: memberId, p_subject: input.subject, p_body: input.body, p_channel: input.channel,
    p_language: input.language, p_submission_status: submission, p_research_snapshot_id: input.research_snapshot_id,
    p_template_version_id: null,
  })
  if (error) fail(error, 'Unable to save message.')
  return asMessage(data)
}
export async function approveMessage(id: string): Promise<OutboundMessage> {
  const { data, error } = await supabase.rpc('approve_manual_outbound_message', { p_outbound_message_id: id })
  if (error) fail(error, 'Unable to approve message.')
  return asMessage(data)
}
export async function skipCampaignMember(id: string, reason?: string): Promise<CampaignMember> {
  const { data, error } = await supabase.rpc('skip_manual_campaign_member', { p_campaign_member_id: id, p_reason: reason ?? null })
  if (error) fail(error, 'Unable to skip this contact.')
  return asMember(data)
}
async function leadsById(): Promise<Map<string, Lead>> {
  const leads = await listLeads()
  return new Map(leads.map((lead) => [lead.id, lead]))
}
export async function listCampaignMembersWithContext(campaignId: string): Promise<CampaignMemberWithLead[]> {
  const [members, leads] = await Promise.all([listCampaignMembers(campaignId), leadsById()])
  return Promise.all(members.map(async (member) => {
    const [research, messages] = await Promise.all([listResearchSnapshots(member.id), listOutboundMessages(member.id)])
    return { ...member, lead: leads.get(member.lead_id) ?? null, latestResearch: research[0] ?? null, latestMessage: messages[0] ?? null }
  }))
}
export async function getCampaignMemberContext(campaignId: string, memberId: string): Promise<{ campaign: Campaign; member: CampaignMember; lead: Lead | null; research: ResearchSnapshot[]; messages: OutboundMessage[] }> {
  const [campaign, members, leads] = await Promise.all([getCampaign(campaignId), listCampaignMembers(campaignId), leadsById()])
  const member = members.find((item) => item.id === memberId)
  if (!member) throw new Error('Campaign member not found.')
  const [research, messages] = await Promise.all([listResearchSnapshots(memberId), listOutboundMessages(memberId)])
  return { campaign, member, lead: leads.get(member.lead_id) ?? null, research, messages }
}
export async function listCampaignSummariesForLead(leadId: string): Promise<Array<{ campaign: Campaign; member: CampaignMember }>> {
  const [campaigns, response] = await Promise.all([listCampaigns(), supabase.from('campaign_members').select('*').eq('lead_id', leadId)])
  if (response.error) fail(response.error, 'Unable to load outreach summary.')
  const byId = new Map(campaigns.map((campaign) => [campaign.id, campaign]))
  return (response.data ?? []).map(asMember).map((member) => ({ member, campaign: byId.get(member.campaign_id) }))
    .filter((item): item is { campaign: Campaign; member: CampaignMember } => Boolean(item.campaign))
}
export async function outreachTaskCounts(): Promise<{ needsReview: number; researchRequired: number; needsAttention: number }> {
  const { data, error } = await supabase.from('campaign_members').select('status')
  if (error) fail(error, 'Unable to load outreach tasks.')
  return (data ?? []).reduce((counts, item) => {
    if (item.status === 'needs_review' || item.status === 'draft_ready') counts.needsReview += 1
    if (item.status === 'queued' || item.status === 'researching') counts.researchRequired += 1
    if (item.status === 'failed' || item.status === 'suppressed') counts.needsAttention += 1
    return counts
  }, { needsReview: 0, researchRequired: 0, needsAttention: 0 })
}

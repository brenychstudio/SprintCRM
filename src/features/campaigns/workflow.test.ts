import { describe, expect, it } from 'vitest'
import { campaignLeadsWizardStep, campaignPickerEligibility, campaignProgress, canSubmitCampaignWizard, eligibilityLabelKey, isCampaignWizardSubmitStep, nextCampaignWizardStep, nextReviewMemberId, previousCampaignWizardStep, reviewQueue } from './workflow'
import type { Lead } from '../leads/types'
import type { CampaignMember } from './types'

function member(id: string, status: CampaignMember['status']): CampaignMember {
  return { id, organization_id: 'org', campaign_id: 'campaign', lead_id: 'lead-' + id, status, skip_reason: null, last_error: null, created_at: '2026-07-25T10:00:00Z', updated_at: '2026-07-25T10:00:00Z' }
}

describe('campaign workflow helpers', () => {
  it('maps workflow states into compact progress', () => {
    expect(campaignProgress([member('1', 'queued'), member('2', 'needs_review'), member('3', 'approved'), member('4', 'sent'), member('5', 'failed')])).toEqual({ toPrepare: 1, needsReview: 1, ready: 1, sent: 1, needsAttention: 1 })
  })
  it('orders review work and selects next member', () => {
    const members = [member('research', 'research_ready'), member('review', 'needs_review'), member('draft', 'draft_ready')]
    expect(reviewQueue(members).map((item) => item.id)).toEqual(['review', 'draft', 'research'])
    expect(nextReviewMemberId(members, 'review')).toBe('draft')
    expect(nextReviewMemberId(members, 'research')).toBe('review')
  })
  it('uses stable eligibility keys', () => {
    expect(eligibilityLabelKey('suppressed')).toBe('campaigns.eligibility.suppressed')
  })
  it('keeps the campaign wizard on Leads after clicking Next from Offer', () => {
    expect(nextCampaignWizardStep(3)).toBe(campaignLeadsWizardStep)
    expect(isCampaignWizardSubmitStep(3)).toBe(false)
    expect(isCampaignWizardSubmitStep(campaignLeadsWizardStep)).toBe(true)
    expect(canSubmitCampaignWizard(3)).toBe(false)
    expect(canSubmitCampaignWizard(campaignLeadsWizardStep)).toBe(true)
    expect(nextCampaignWizardStep(campaignLeadsWizardStep)).toBe(campaignLeadsWizardStep)
    expect(previousCampaignWizardStep(campaignLeadsWizardStep)).toBe(3)
  })
  it('recalculates campaign eligibility after a contact channel is added', () => {
    const lead = { id: 'lead-1', status: 'active', email: null, phone: null, website: null, email_norm: null, website_domain_norm: null } as Lead
    expect(campaignPickerEligibility(lead, new Set(), []).outcome).toBe('needs_information')
    expect(campaignPickerEligibility({ ...lead, email: 'hello@example.com', email_norm: 'hello@example.com' }, new Set(), []).outcome).toBe('eligible')
  })
})

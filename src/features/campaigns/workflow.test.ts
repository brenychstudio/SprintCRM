import { describe, expect, it } from 'vitest'
import { campaignProgress, eligibilityLabelKey, nextReviewMemberId, reviewQueue } from './workflow'
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
})

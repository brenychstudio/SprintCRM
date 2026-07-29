import type { CampaignMember, CampaignMemberStatus, CampaignProgress, EligibilityOutcome } from './types'

export const campaignWizardSteps = [1, 2, 3, 4] as const
export type CampaignWizardStep = (typeof campaignWizardSteps)[number]
export const campaignLeadsWizardStep: CampaignWizardStep = 4

export function nextCampaignWizardStep(step: CampaignWizardStep): CampaignWizardStep {
  return step >= campaignLeadsWizardStep ? campaignLeadsWizardStep : (step + 1) as CampaignWizardStep
}

export function previousCampaignWizardStep(step: CampaignWizardStep): CampaignWizardStep {
  return step <= 1 ? 1 : (step - 1) as CampaignWizardStep
}

export function isCampaignWizardSubmitStep(step: CampaignWizardStep): boolean {
  return step === campaignLeadsWizardStep
}

/**
 * The editor is a single native form. Keep the submit boundary explicit so an
 * implicit submit (for example, from the keyboard) can never create a
 * campaign before the user reaches the Leads step.
 */
export function canSubmitCampaignWizard(step: CampaignWizardStep): boolean {
  return isCampaignWizardSubmitStep(step)
}

const reviewPriority: Record<CampaignMemberStatus, number> = {
  needs_review: 0, draft_ready: 1, research_ready: 2, failed: 3, queued: 4, researching: 5,
  followup_due: 6, approved: 7, provider_draft: 8, sent: 9, replied: 10, skipped: 11, suppressed: 12,
}
export function campaignStatusTone(status: CampaignMemberStatus): 'prepare' | 'review' | 'ready' | 'sent' | 'attention' {
  if (status === 'needs_review' || status === 'draft_ready') return 'review'
  if (status === 'approved' || status === 'provider_draft') return 'ready'
  if (status === 'sent' || status === 'replied') return 'sent'
  if (status === 'failed' || status === 'suppressed') return 'attention'
  return 'prepare'
}

export function campaignProgress(members: Pick<CampaignMember, 'status'>[]): CampaignProgress {
  return members.reduce<CampaignProgress>((progress, member) => {
    const group = campaignStatusTone(member.status)
    if (group === 'prepare') progress.toPrepare += 1
    if (group === 'review') progress.needsReview += 1
    if (group === 'ready') progress.ready += 1
    if (group === 'sent') progress.sent += 1
    if (group === 'attention') progress.needsAttention += 1
    return progress
  }, { toPrepare: 0, needsReview: 0, ready: 0, sent: 0, needsAttention: 0 })
}

export function reviewQueue(members: CampaignMember[]): CampaignMember[] {
  return members.filter((member) => ['needs_review', 'draft_ready', 'research_ready', 'failed'].includes(member.status))
    .sort((a, b) => reviewPriority[a.status] - reviewPriority[b.status] || a.updated_at.localeCompare(b.updated_at))
}

export function nextReviewMemberId(members: CampaignMember[], currentMemberId?: string): string | null {
  const queue = reviewQueue(members)
  if (!queue.length) return null
  if (!currentMemberId) return queue[0].id
  const index = queue.findIndex((member) => member.id === currentMemberId)
  return queue[index + 1]?.id ?? queue.find((member) => member.id !== currentMemberId)?.id ?? null
}

export function eligibilityLabelKey(outcome: EligibilityOutcome): string {
  return 'campaigns.eligibility.' + outcome
}

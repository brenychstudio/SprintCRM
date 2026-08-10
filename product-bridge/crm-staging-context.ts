import type { Json } from '../src/lib/supabase/database.types.js'

export const CRM_STAGED_WRITE_OPERATIONS = {
  RESEARCH_SNAPSHOT: 'crm.research.stageSnapshot',
  EMAIL_DRAFT: 'crm.email.stageDraft',
} as const

export type CrmStagedWriteOperationId =
  (typeof CRM_STAGED_WRITE_OPERATIONS)[keyof typeof CRM_STAGED_WRITE_OPERATIONS]

export type CampaignMemberStagingStatus =
  | 'queued'
  | 'researching'
  | 'research_ready'
  | 'draft_ready'
  | 'needs_review'
  | 'approved'
  | 'provider_draft'
  | 'sent'
  | 'replied'
  | 'followup_due'
  | 'skipped'
  | 'suppressed'
  | 'failed'

export interface CrmStagingContext {
  readonly organizationId: string
  readonly actorSubject: string
  readonly campaignMember: {
    readonly id: string
    readonly status: CampaignMemberStagingStatus
    readonly updatedAt: string
  }
  readonly campaign: {
    readonly id: string
    readonly channel: 'email' | 'linkedin' | 'ig' | 'other'
    readonly defaultLanguage: 'en' | 'es' | 'uk' | 'ru'
    readonly updatedAt: string
  }
  readonly lead: {
    readonly language: string | null
    readonly updatedAt: string
  }
  readonly latestResearch: null | {
    readonly id: string
    readonly version: number
    readonly createdAt: string
  }
  readonly latestOutboundMessage: null | {
    readonly id: string
    readonly version: number
    readonly status: string
    readonly updatedAt: string
  }
  readonly freshness: {
    readonly subjectType: 'campaign_member_staging_context'
    readonly subjectId: string
    readonly version: `sha256:${string}`
    readonly generatedAt: string
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u
const MEMBER_STATUSES = new Set<CampaignMemberStagingStatus>([
  'queued', 'researching', 'research_ready', 'draft_ready', 'needs_review',
  'approved', 'provider_draft', 'sent', 'replied', 'followup_due', 'skipped',
  'suppressed', 'failed',
])
const CHANNELS = new Set(['email', 'linkedin', 'ig', 'other'])
const LANGUAGES = new Set(['en', 'es', 'uk', 'ru'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isVersionedRecord(value: unknown, kind: 'research' | 'message'): boolean {
  if (value === null) return true
  if (!isRecord(value)) return false
  const keys = kind === 'research'
    ? ['id', 'version', 'createdAt']
    : ['id', 'version', 'status', 'updatedAt']
  if (!exactKeys(value, keys) || !isUuid(value.id) || !Number.isInteger(value.version) || Number(value.version) < 1) {
    return false
  }
  return kind === 'research'
    ? isTimestamp(value.createdAt)
    : typeof value.status === 'string' && value.status.length <= 32 && isTimestamp(value.updatedAt)
}

/** Fail-closed parser for the deliberately PII/content-free staging context RPC. */
export function parseCrmStagingContext(value: Json | null): CrmStagingContext {
  if (!isRecord(value) || !exactKeys(value, [
    'organizationId', 'actorSubject', 'campaignMember', 'campaign', 'lead',
    'latestResearch', 'latestOutboundMessage', 'freshness',
  ])) throw new Error('SprintCRM staging context is unavailable.')

  const member = value.campaignMember
  const campaign = value.campaign
  const lead = value.lead
  const freshness = value.freshness
  if (!isUuid(value.organizationId)
      || typeof value.actorSubject !== 'string'
      || !/^user:[0-9a-f-]{36}$/iu.test(value.actorSubject)
      || !isRecord(member)
      || !exactKeys(member, ['id', 'status', 'updatedAt'])
      || !isUuid(member.id)
      || typeof member.status !== 'string'
      || !MEMBER_STATUSES.has(member.status as CampaignMemberStagingStatus)
      || !isTimestamp(member.updatedAt)
      || !isRecord(campaign)
      || !exactKeys(campaign, ['id', 'channel', 'defaultLanguage', 'updatedAt'])
      || !isUuid(campaign.id)
      || typeof campaign.channel !== 'string'
      || !CHANNELS.has(campaign.channel)
      || typeof campaign.defaultLanguage !== 'string'
      || !LANGUAGES.has(campaign.defaultLanguage)
      || !isTimestamp(campaign.updatedAt)
      || !isRecord(lead)
      || !exactKeys(lead, ['language', 'updatedAt'])
      || !(lead.language === null || (typeof lead.language === 'string' && lead.language.length <= 16))
      || !isTimestamp(lead.updatedAt)
      || !isVersionedRecord(value.latestResearch, 'research')
      || !isVersionedRecord(value.latestOutboundMessage, 'message')
      || !isRecord(freshness)
      || !exactKeys(freshness, ['subjectType', 'subjectId', 'version', 'generatedAt'])
      || freshness.subjectType !== 'campaign_member_staging_context'
      || freshness.subjectId !== member.id
      || typeof freshness.version !== 'string'
      || !SHA256_PATTERN.test(freshness.version)
      || !isTimestamp(freshness.generatedAt)) {
    throw new Error('SprintCRM staging context is unavailable.')
  }

  return value as unknown as CrmStagingContext
}

export function assertUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error('SprintCRM staged write input is invalid.')
}

export function assertSemanticFingerprint(value: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error('SprintCRM staged write input is invalid.')
}

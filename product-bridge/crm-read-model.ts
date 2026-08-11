import { createHash } from 'node:crypto'

export const CRM_READ_LIMITS = Object.freeze({
  listDefault: 10,
  listMaximum: 25,
  activitiesDefault: 20,
  activitiesMaximum: 50,
  queryMaximumCharacters: 100,
  cursorMaximumCharacters: 768,
  outputMaximumBytes: 262_144,
})

export const CRM_LEAD_STAGES = Object.freeze([
  'new',
  'contacted',
  'replied',
  'proposal',
  'won',
  'lost',
] as const)

export const CRM_ACTIVE_QUEUE_STAGES = Object.freeze([
  'new',
  'contacted',
  'replied',
  'proposal',
] as const)

export const CRM_LEAD_STATUSES = Object.freeze(['active', 'archived'] as const)
export const CRM_NEXT_ACTIONS = Object.freeze([
  'follow_up',
  'send_proposal',
  'request_call',
  'nurture',
] as const)

export const CRM_ACTIVITY_TYPES = Object.freeze([
  'imported',
  'contacted',
  'replied',
  'proposal_sent',
  'won',
  'lost',
  'note',
  'stage_changed',
  'next_action_set',
  'ai_draft_generated',
  'ai_draft_applied',
  'ai_draft_copied',
  'outreach_sent',
  'followup_scheduled',
  'reply_marked',
  'manual_edit',
  'campaign_added',
  'research_saved',
  'outreach_draft_saved',
  'outreach_approved',
  'campaign_skipped',
] as const)

export type CrmLeadStage = (typeof CRM_LEAD_STAGES)[number]
export type CrmActiveQueueStage = (typeof CRM_ACTIVE_QUEUE_STAGES)[number]
export type CrmLeadStatus = (typeof CRM_LEAD_STATUSES)[number]
export type CrmNextAction = (typeof CRM_NEXT_ACTIONS)[number]
export type CrmActivityType = (typeof CRM_ACTIVITY_TYPES)[number]
export type CrmMembershipRole = 'owner' | 'admin' | 'member'

export interface WorkspaceReadRecord {
  readonly organizationId: string
  readonly organizationName: string
  readonly membershipRole: CrmMembershipRole
}

export interface LeadReadRecord {
  readonly id: string
  readonly company_name: string
  readonly contact_name: string | null
  readonly website_domain: string | null
  readonly niche: string | null
  readonly country_city: string | null
  readonly service_interest: string | null
  readonly offer_type?: string | null
  readonly stage: CrmLeadStage
  readonly status: CrmLeadStatus
  readonly next_action: CrmNextAction
  readonly next_action_at: string
  readonly last_touch_at?: string
  readonly preferred_channel?: string | null
  readonly language?: string | null
  readonly reply_status?: string | null
  readonly revenue?: number | null
  readonly email?: string | null
  readonly phone?: string | null
  readonly created_at: string
  readonly updated_at: string
}

export interface ActivityReadRecord {
  readonly id: string
  readonly lead_id: string
  readonly type: CrmActivityType
  readonly channel: string | null
  readonly at: string
  readonly meta_from: string | null
  readonly meta_to: string | null
  readonly meta_stage: string | null
  readonly meta_next_action: string | null
  readonly meta_next_action_at: string | null
  readonly meta_changed_fields: unknown
  readonly meta_version: string | null
  readonly meta_source: string | null
  readonly meta_status: string | null
  readonly meta_reply_status: string | null
}

export interface SearchCursorPosition {
  readonly createdAt: string
  readonly leadId: string
}

export interface FollowupCursorPosition {
  readonly nextActionAt: string
  readonly leadId: string
}

export interface LeadSearchGatewayInput {
  readonly q?: string
  readonly stage?: CrmLeadStage
  readonly status: CrmLeadStatus
  readonly nextAction?: CrmNextAction
  readonly cursor?: SearchCursorPosition
  readonly fetchLimit: number
}

export interface ActionQueueGatewayInput {
  readonly dueBefore: string
  readonly stage?: CrmActiveQueueStage
  readonly fetchLimit: number
}

export interface FollowupsGatewayInput {
  readonly dueBefore: string
  readonly stage?: CrmActiveQueueStage
  readonly cursor?: FollowupCursorPosition
  readonly fetchLimit: number
}

export interface RecentActivitiesGatewayInput {
  readonly leadId: string
  readonly types?: readonly CrmActivityType[]
  readonly fetchLimit: number
}

export interface PipelineGatewayFilters {
  readonly status: CrmLeadStatus
  readonly niche?: string
  readonly serviceInterest?: string
}

/** Fixed, organization-bound SELECT/HEAD boundary. It intentionally exposes no mutation methods. */
export interface SprintCrmReadGateway {
  getWorkspace(): Promise<WorkspaceReadRecord>
  searchLeads(input: LeadSearchGatewayInput): Promise<readonly LeadReadRecord[]>
  getLead(leadId: string, includeContactData: boolean): Promise<LeadReadRecord | null>
  listActionQueue(input: ActionQueueGatewayInput): Promise<readonly LeadReadRecord[]>
  listDueFollowups(input: FollowupsGatewayInput): Promise<readonly LeadReadRecord[]>
  getLeadWatermark(leadId: string): Promise<{ readonly id: string; readonly updatedAt: string } | null>
  listRecentActivities(input: RecentActivitiesGatewayInput): Promise<readonly ActivityReadRecord[]>
  countPipelineStage(stage: CrmLeadStage, filters: PipelineGatewayFilters): Promise<number>
  getPipelineLatestUpdatedAt(filters: PipelineGatewayFilters): Promise<string | null>
}

export interface LeadSearchInput {
  readonly q?: string
  readonly stage?: CrmLeadStage
  readonly status?: CrmLeadStatus
  readonly nextAction?: CrmNextAction
  readonly cursor?: string
  readonly limit?: number
}

export interface LeadGetInput {
  readonly leadId: string
}

export interface ActionQueueInput {
  readonly dueBefore?: string
  readonly stage?: CrmActiveQueueStage
  readonly limit?: number
}

export interface DueFollowupsInput {
  readonly dueBefore?: string
  readonly stage?: CrmActiveQueueStage
  readonly cursor?: string
  readonly limit?: number
}

export interface RecentActivitiesInput {
  readonly leadId: string
  readonly types?: readonly CrmActivityType[]
  readonly limit?: number
}

export interface PipelineSummaryInput {
  readonly status?: CrmLeadStatus
  readonly niche?: string
  readonly serviceInterest?: string
}

export interface TrustedReadAccess {
  readonly includeContactData: boolean
}

interface ReadEvidence {
  readonly generatedAt: string
  readonly canonicalStateVersion: string
}

export interface SafeLeadSummary {
  readonly leadId: string
  readonly companyName: string
  readonly contactName: string | null
  readonly websiteDomain: string | null
  readonly niche: string | null
  readonly location: string | null
  readonly serviceInterest: string | null
  readonly stage: CrmLeadStage
  readonly status: CrmLeadStatus
  readonly nextAction: CrmNextAction
  readonly nextActionAt: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface WorkspaceContextResult extends ReadEvidence {
  readonly workspace: {
    readonly organizationId: string
    readonly organizationName: string
    readonly membershipRole: CrmMembershipRole
  }
  readonly capabilities: readonly string[]
}

export interface LeadSearchResult extends ReadEvidence {
  readonly leads: readonly SafeLeadSummary[]
  readonly page: {
    readonly hasMore: boolean
    readonly nextCursor: string | null
  }
}

export type LeadGetResult = ReadEvidence & (
  | {
      readonly found: false
      readonly contactDataIncluded: false
    }
  | {
      readonly found: true
      readonly contactDataIncluded: boolean
      readonly lead: SafeLeadSummary & {
        readonly offerType: string | null
        readonly lastTouchAt: string
        readonly preferredChannel: string | null
        readonly language: string | null
        readonly replyStatus: string | null
        readonly revenue: number | null
        readonly contact?: {
          readonly email: string | null
          readonly phone: string | null
        }
      }
    }
)

export interface SafeDueLead {
  readonly leadId: string
  readonly companyName: string
  readonly contactName: string | null
  readonly stage: CrmLeadStage
  readonly nextAction: CrmNextAction
  readonly dueAt: string
  readonly overdue: boolean
  readonly dueToday: boolean
  readonly updatedAt: string
}

export interface ActionQueueResult extends ReadEvidence {
  readonly items: readonly SafeDueLead[]
  readonly dueBefore: string
  readonly hasMore: boolean
}

export interface DueFollowupsResult extends ReadEvidence {
  readonly representation: 'lead_backed_next_action'
  readonly followups: readonly SafeDueLead[]
  readonly page: {
    readonly hasMore: boolean
    readonly nextCursor: string | null
  }
}

export interface SafeActivity {
  readonly activityId: string
  readonly leadId: string
  readonly type: CrmActivityType
  readonly channel: string | null
  readonly at: string
  readonly metadata: Readonly<Record<string, string | number | readonly string[]>>
}

export interface RecentActivitiesResult extends ReadEvidence {
  readonly foundLead: boolean
  readonly activities: readonly SafeActivity[]
  readonly hasMore: boolean
}

export interface PipelineSummaryResult extends ReadEvidence {
  readonly status: CrmLeadStatus
  readonly filters: {
    readonly niche: string | null
    readonly serviceInterest: string | null
  }
  readonly countsByStage: Readonly<Record<CrmLeadStage, number>>
  readonly total: number
  readonly latestUpdatedAt: string | null
  readonly consistency: 'bounded_multi_query_read'
}

export interface SprintCrmSemanticReadModel {
  getWorkspaceContext(): Promise<WorkspaceContextResult>
  searchLeads(input: LeadSearchInput): Promise<LeadSearchResult>
  getLead(input: LeadGetInput, access: TrustedReadAccess): Promise<LeadGetResult>
  listActionQueue(input: ActionQueueInput): Promise<ActionQueueResult>
  listDueFollowups(input: DueFollowupsInput): Promise<DueFollowupsResult>
  listRecentActivities(input: RecentActivitiesInput): Promise<RecentActivitiesResult>
  getPipelineSummary(input: PipelineSummaryInput): Promise<PipelineSummaryResult>
}

type CursorKind = 'lead_search' | 'due_followups'

interface CursorPayload {
  readonly version: 1
  readonly kind: CursorKind
  readonly at: string
  readonly leadId: string
  readonly filterHash: string
  readonly boundary?: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u
export const CRM_SAFE_MANUAL_EDIT_FIELDS = Object.freeze([
  'company_name',
  'contact_name',
  'website',
  'preferred_channel',
  'niche',
  'country_city',
  'language',
] as const)
export const CRM_SAFE_ACTIVITY_SOURCES = Object.freeze([
  'manual', 'campaign', 'runtime', 'operator', 'system',
] as const)
export const CRM_SAFE_ACTIVITY_STATUSES = Object.freeze([
  'draft', 'approved', 'applied', 'saved', 'completed',
] as const)
export const CRM_SAFE_REPLY_STATUSES = Object.freeze([
  'not_sent',
  'sent',
  'no_reply',
  'replied',
  'positive',
  'negative',
] as const)

function canonicalHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40 || !/T/u.test(value)) return false
  return /(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value))
}

function boundedString(value: string | null | undefined, maximum: number): string | null {
  if (value === null || value === undefined) return null
  const normalized = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127 ? ' ' : character
  }).join('')
    .replace(/\s+/gu, ' ')
    .trim()
  return normalized.length === 0 ? null : normalized.slice(0, maximum)
}

function finiteRevenue(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function limitOrDefault(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= maximum
    ? Number(value)
    : fallback
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodeCursor(value: string, expectedKind: CursorKind, filterHash?: string): CursorPayload | null {
  if (value.length === 0 || value.length > CRM_READ_LIMITS.cursorMaximumCharacters || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!isRecord(parsed) || Object.keys(parsed).some((key) => !['version', 'kind', 'at', 'leadId', 'filterHash', 'boundary'].includes(key))) {
      return null
    }
    if (
      parsed.version !== 1
      || parsed.kind !== expectedKind
      || !isTimestamp(parsed.at)
      || !isUuid(parsed.leadId)
      || !SHA256_PATTERN.test(String(parsed.filterHash))
      || (filterHash !== undefined && parsed.filterHash !== filterHash)
      || (parsed.boundary !== undefined && !isTimestamp(parsed.boundary))
    ) return null
    return parsed as unknown as CursorPayload
  } catch {
    return null
  }
}

function normalizedSearchFilters(input: LeadSearchInput) {
  return {
    q: input.q?.trim() || null,
    stage: input.stage ?? null,
    status: input.status ?? 'active',
    nextAction: input.nextAction ?? null,
  }
}

function normalizedFollowupFilters(input: DueFollowupsInput, dueBefore: string) {
  return { dueBefore, stage: input.stage ?? null }
}

export function isValidLeadSearchCursor(input: LeadSearchInput): boolean {
  if (input.cursor === undefined) return true
  const filterHash = canonicalHash(normalizedSearchFilters(input))
  return decodeCursor(input.cursor, 'lead_search', filterHash) !== null
}

export function isValidDueFollowupsCursor(input: DueFollowupsInput): boolean {
  if (input.cursor === undefined) return true
  const structural = decodeCursor(input.cursor, 'due_followups')
  if (!structural?.boundary) return false
  const dueBefore = input.dueBefore ?? structural.boundary
  if (!isTimestamp(dueBefore) || dueBefore !== structural.boundary) return false
  const filterHash = canonicalHash(normalizedFollowupFilters(input, dueBefore))
  return decodeCursor(input.cursor, 'due_followups', filterHash) !== null
}

interface MadridDayBounds {
  readonly start: string
  readonly end: string
}

function madridDateParts(date: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value)
  return { year: part('year'), month: part('month'), day: part('day') }
}

function timeZoneOffsetMilliseconds(date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    timeZoneName: 'shortOffset',
  })
  const raw = formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  const match = /^GMT(?:(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?)?$/u.exec(raw)
  if (!match?.groups?.sign) return 0
  const minutes = Number(match.groups.hours) * 60 + Number(match.groups.minutes ?? '0')
  return (match.groups.sign === '-' ? -1 : 1) * minutes * 60_000
}

function madridLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): string {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
  let candidate = localAsUtc
  for (let iteration = 0; iteration < 3; iteration += 1) {
    candidate = localAsUtc - timeZoneOffsetMilliseconds(new Date(candidate))
  }
  return new Date(candidate).toISOString()
}

export function getMadridDayBounds(nowIso: string): MadridDayBounds {
  const now = new Date(nowIso)
  const { year, month, day } = madridDateParts(now)
  return {
    start: madridLocalToUtc(year, month, day, 0, 0, 0, 0),
    end: madridLocalToUtc(year, month, day, 23, 59, 59, 999),
  }
}

function safeLeadSummary(row: LeadReadRecord): SafeLeadSummary {
  return {
    leadId: row.id,
    companyName: boundedString(row.company_name, 240) ?? 'Unnamed lead',
    contactName: boundedString(row.contact_name, 240),
    websiteDomain: boundedString(row.website_domain, 253),
    niche: boundedString(row.niche, 300),
    location: boundedString(row.country_city, 300),
    serviceInterest: boundedString(row.service_interest, 500),
    stage: row.stage,
    status: row.status,
    nextAction: row.next_action,
    nextActionAt: row.next_action_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function safeDueLead(row: LeadReadRecord, day: MadridDayBounds): SafeDueLead {
  const due = row.next_action_at
  const dueMilliseconds = Date.parse(due)
  const startMilliseconds = Date.parse(day.start)
  const endMilliseconds = Date.parse(day.end)
  return {
    leadId: row.id,
    companyName: boundedString(row.company_name, 240) ?? 'Unnamed lead',
    contactName: boundedString(row.contact_name, 240),
    stage: row.stage,
    nextAction: row.next_action,
    dueAt: due,
    overdue: dueMilliseconds < startMilliseconds,
    dueToday: dueMilliseconds >= startMilliseconds && dueMilliseconds <= endMilliseconds,
    updatedAt: row.updated_at,
  }
}

function safeActivityMetadata(row: ActivityReadRecord): Record<string, string | number | readonly string[]> {
  const metadata: Record<string, string | number | readonly string[]> = {}
  const stage = (value: string | null) => CRM_LEAD_STAGES.includes(value as CrmLeadStage) ? value as CrmLeadStage : null
  const action = (value: string | null) => CRM_NEXT_ACTIONS.includes(value as CrmNextAction) ? value as CrmNextAction : null
  const timestamp = (value: string | null) => isTimestamp(value) ? value : null
  const version = Number(row.meta_version)

  if (row.type === 'stage_changed') {
    const fromStage = stage(row.meta_from)
    const toStage = stage(row.meta_to)
    const nextAction = action(row.meta_next_action)
    const nextActionAt = timestamp(row.meta_next_action_at)
    if (fromStage) metadata.fromStage = fromStage
    if (toStage) metadata.toStage = toStage
    if (nextAction) metadata.nextAction = nextAction
    if (nextActionAt) metadata.nextActionAt = nextActionAt
  } else if (row.type === 'next_action_set' || row.type === 'followup_scheduled') {
    const currentStage = stage(row.meta_stage)
    const nextAction = action(row.meta_next_action)
    const nextActionAt = timestamp(row.meta_next_action_at)
    if (currentStage) metadata.stage = currentStage
    if (nextAction) metadata.nextAction = nextAction
    if (nextActionAt) metadata.nextActionAt = nextActionAt
  } else if (row.type === 'manual_edit' && Array.isArray(row.meta_changed_fields)) {
    const changedFields = [...new Set(row.meta_changed_fields.filter(
      (field): field is string => typeof field === 'string'
        && CRM_SAFE_MANUAL_EDIT_FIELDS.includes(field as never),
    ))].slice(0, CRM_SAFE_MANUAL_EDIT_FIELDS.length)
    if (changedFields.length > 0) metadata.changedFields = changedFields
  } else if (row.type === 'research_saved') {
    if (Number.isSafeInteger(version) && version >= 1 && version <= 1_000_000) metadata.version = version
    if (row.meta_source && CRM_SAFE_ACTIVITY_SOURCES.includes(row.meta_source as never)) metadata.source = row.meta_source
  } else if (row.type === 'outreach_draft_saved') {
    if (Number.isSafeInteger(version) && version >= 1 && version <= 1_000_000) metadata.version = version
    if (row.meta_source && CRM_SAFE_ACTIVITY_SOURCES.includes(row.meta_source as never)) metadata.source = row.meta_source
    if (row.meta_status && CRM_SAFE_ACTIVITY_STATUSES.includes(row.meta_status as never)) metadata.status = row.meta_status
  } else if (row.type === 'outreach_approved') {
    if (Number.isSafeInteger(version) && version >= 1 && version <= 1_000_000) metadata.version = version
  } else if (
    row.type === 'reply_marked'
    && row.meta_reply_status
    && CRM_SAFE_REPLY_STATUSES.includes(row.meta_reply_status as never)
  ) {
    metadata.replyStatus = row.meta_reply_status
  }

  return metadata
}

function safeActivity(row: ActivityReadRecord): SafeActivity {
  return {
    activityId: row.id,
    leadId: row.lead_id,
    type: row.type,
    channel: boundedString(row.channel, 32),
    at: row.at,
    metadata: safeActivityMetadata(row),
  }
}

export class ProductOwnedSprintCrmReadModel implements SprintCrmSemanticReadModel {
  constructor(
    private readonly gateway: SprintCrmReadGateway,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async getWorkspaceContext(): Promise<WorkspaceContextResult> {
    const workspace = await this.gateway.getWorkspace()
    const safeWorkspace = {
      organizationId: workspace.organizationId,
      organizationName: boundedString(workspace.organizationName, 240) ?? 'SprintCRM workspace',
      membershipRole: workspace.membershipRole,
    }
    const capabilities = Object.freeze([
      'crm.workspace.getContext',
      'crm.leads.search',
      'crm.leads.get',
      'crm.leads.listActionQueue',
      'crm.followups.listDue',
      'crm.activities.listRecent',
      'crm.pipeline.getSummary',
      'crm.outreach.getStagingContext',
      'crm.research.stageSnapshot',
      'crm.email.stageDraft',
    ])
    return {
      workspace: safeWorkspace,
      capabilities,
      generatedAt: this.now(),
      canonicalStateVersion: canonicalHash({ workspace: safeWorkspace, capabilities }),
    }
  }

  async searchLeads(input: LeadSearchInput): Promise<LeadSearchResult> {
    const filters = normalizedSearchFilters(input)
    const limit = limitOrDefault(input.limit, CRM_READ_LIMITS.listDefault, CRM_READ_LIMITS.listMaximum)
    const filterHash = canonicalHash(filters)
    const cursor = input.cursor ? decodeCursor(input.cursor, 'lead_search', filterHash) : null
    const rows = await this.gateway.searchLeads({
      q: filters.q ?? undefined,
      stage: filters.stage ?? undefined,
      status: filters.status,
      nextAction: filters.nextAction ?? undefined,
      cursor: cursor ? { createdAt: cursor.at, leadId: cursor.leadId } : undefined,
      fetchLimit: limit + 1,
    })
    const hasMore = rows.length > limit
    const pageRows = rows.slice(0, limit)
    const leads = pageRows.map(safeLeadSummary)
    const last = pageRows.at(-1)
    const nextCursor = hasMore && last
      ? encodeCursor({ version: 1, kind: 'lead_search', at: last.created_at, leadId: last.id, filterHash })
      : null
    const evidence = { filters, rows: pageRows.map((row) => [row.id, row.created_at, row.updated_at]), nextCursor }
    return {
      leads,
      page: { hasMore, nextCursor },
      generatedAt: this.now(),
      canonicalStateVersion: canonicalHash(evidence),
    }
  }

  async getLead(input: LeadGetInput, access: TrustedReadAccess): Promise<LeadGetResult> {
    const row = await this.gateway.getLead(input.leadId, access.includeContactData)
    if (!row) {
      return {
        found: false,
        contactDataIncluded: false,
        generatedAt: this.now(),
        canonicalStateVersion: canonicalHash({ leadId: input.leadId, found: false }),
      }
    }
    const lead = {
      ...safeLeadSummary(row),
      offerType: boundedString(row.offer_type, 300),
      lastTouchAt: row.last_touch_at ?? row.updated_at,
      preferredChannel: boundedString(row.preferred_channel, 32),
      language: boundedString(row.language, 16),
      replyStatus: boundedString(row.reply_status, 32),
      revenue: finiteRevenue(row.revenue),
      ...(access.includeContactData ? {
        contact: {
          email: boundedString(row.email, 320),
          phone: boundedString(row.phone, 64),
        },
      } : {}),
    }
    return {
      found: true,
      contactDataIncluded: access.includeContactData,
      lead,
      generatedAt: this.now(),
      canonicalStateVersion: `lead:${row.id}:${row.updated_at}`,
    }
  }

  async listActionQueue(input: ActionQueueInput): Promise<ActionQueueResult> {
    const generatedAt = this.now()
    const day = getMadridDayBounds(generatedAt)
    const dueBefore = input.dueBefore ?? day.end
    const limit = limitOrDefault(input.limit, CRM_READ_LIMITS.listDefault, CRM_READ_LIMITS.listMaximum)
    const rows = await this.gateway.listActionQueue({
      dueBefore,
      stage: input.stage,
      fetchLimit: limit + 1,
    })
    const hasMore = rows.length > limit
    const pageRows = rows.slice(0, limit)
    const items = pageRows.map((row) => safeDueLead(row, day))
    return {
      items,
      dueBefore,
      hasMore,
      generatedAt,
      canonicalStateVersion: canonicalHash({
        dueBefore,
        stage: input.stage ?? null,
        rows: pageRows.map((row) => [row.id, row.next_action_at, row.updated_at]),
      }),
    }
  }

  async listDueFollowups(input: DueFollowupsInput): Promise<DueFollowupsResult> {
    const generatedAt = this.now()
    const day = getMadridDayBounds(generatedAt)
    const structuralCursor = input.cursor ? decodeCursor(input.cursor, 'due_followups') : null
    const dueBefore = input.dueBefore ?? structuralCursor?.boundary ?? day.end
    const limit = limitOrDefault(input.limit, CRM_READ_LIMITS.listDefault, CRM_READ_LIMITS.listMaximum)
    const filters = normalizedFollowupFilters(input, dueBefore)
    const filterHash = canonicalHash(filters)
    const cursor = input.cursor ? decodeCursor(input.cursor, 'due_followups', filterHash) : null
    const rows = await this.gateway.listDueFollowups({
      dueBefore,
      stage: input.stage,
      cursor: cursor ? { nextActionAt: cursor.at, leadId: cursor.leadId } : undefined,
      fetchLimit: limit + 1,
    })
    const hasMore = rows.length > limit
    const pageRows = rows.slice(0, limit)
    const followups = pageRows.map((row) => safeDueLead(row, day))
    const last = pageRows.at(-1)
    const nextCursor = hasMore && last
      ? encodeCursor({
          version: 1,
          kind: 'due_followups',
          at: last.next_action_at,
          leadId: last.id,
          filterHash,
          boundary: dueBefore,
        })
      : null
    return {
      representation: 'lead_backed_next_action',
      followups,
      page: { hasMore, nextCursor },
      generatedAt,
      canonicalStateVersion: canonicalHash({
        filters,
        rows: pageRows.map((row) => [row.id, row.next_action_at, row.updated_at]),
        nextCursor,
      }),
    }
  }

  async listRecentActivities(input: RecentActivitiesInput): Promise<RecentActivitiesResult> {
    const lead = await this.gateway.getLeadWatermark(input.leadId)
    if (!lead) {
      return {
        foundLead: false,
        activities: [],
        hasMore: false,
        generatedAt: this.now(),
        canonicalStateVersion: canonicalHash({ leadId: input.leadId, found: false }),
      }
    }
    const limit = limitOrDefault(input.limit, CRM_READ_LIMITS.activitiesDefault, CRM_READ_LIMITS.activitiesMaximum)
    const rows = await this.gateway.listRecentActivities({
      leadId: input.leadId,
      types: input.types,
      fetchLimit: limit + 1,
    })
    const hasMore = rows.length > limit
    const pageRows = rows.slice(0, limit)
    const activities = pageRows.map(safeActivity)
    return {
      foundLead: true,
      activities,
      hasMore,
      generatedAt: this.now(),
      canonicalStateVersion: canonicalHash({
        lead: [lead.id, lead.updatedAt],
        rows: activities.map(({ activityId, at, type }) => [activityId, at, type]),
      }),
    }
  }

  async getPipelineSummary(input: PipelineSummaryInput): Promise<PipelineSummaryResult> {
    const filters: PipelineGatewayFilters = {
      status: input.status ?? 'active',
      niche: input.niche?.trim() || undefined,
      serviceInterest: input.serviceInterest?.trim() || undefined,
    }
    const [counts, latestUpdatedAt] = await Promise.all([
      Promise.all(CRM_LEAD_STAGES.map((stage) => this.gateway.countPipelineStage(stage, filters))),
      this.gateway.getPipelineLatestUpdatedAt(filters),
    ])
    const countsByStage = Object.fromEntries(CRM_LEAD_STAGES.map((stage, index) => [stage, counts[index] ?? 0])) as Record<CrmLeadStage, number>
    const total = counts.reduce((sum, count) => sum + count, 0)
    return {
      status: filters.status,
      filters: {
        niche: boundedString(filters.niche, 300),
        serviceInterest: boundedString(filters.serviceInterest, 500),
      },
      countsByStage,
      total,
      latestUpdatedAt,
      consistency: 'bounded_multi_query_read',
      generatedAt: this.now(),
      canonicalStateVersion: canonicalHash({ filters, countsByStage, latestUpdatedAt }),
    }
  }
}

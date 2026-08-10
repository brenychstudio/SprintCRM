import {
  OPERATION_CLASSES,
  type ActionRequest,
  type ProductCapability,
  type ProductDescriptor,
  type ProductOperationDefinition,
  type SafeValue,
  type SchemaValidationResult,
} from '@brenych/product-bridge-contracts'
import {
  defineRuntimeSchema,
  type ProductAdapter,
  type ProductInvocationResult,
} from '@brenych/product-bridge-product-sdk'

import {
  CRM_ACTIVE_QUEUE_STAGES,
  CRM_ACTIVITY_TYPES,
  CRM_LEAD_STAGES,
  CRM_LEAD_STATUSES,
  CRM_NEXT_ACTIONS,
  CRM_READ_LIMITS,
  CRM_SAFE_ACTIVITY_SOURCES,
  CRM_SAFE_ACTIVITY_STATUSES,
  CRM_SAFE_MANUAL_EDIT_FIELDS,
  CRM_SAFE_REPLY_STATUSES,
  isValidDueFollowupsCursor,
  isValidLeadSearchCursor,
  type ActionQueueInput,
  type DueFollowupsInput,
  type LeadGetInput,
  type LeadSearchInput,
  type PipelineSummaryInput,
  type RecentActivitiesInput,
  type SprintCrmSemanticReadModel,
} from './crm-read-model.js'

export const SPRINT_CRM_PRODUCT_ID = 'sprint-crm' as const
export const SPRINT_CRM_PRODUCT_VERSION = '0.0.0' as const
export const SPRINT_CRM_ADAPTER_VERSION = '0.1.0-dev' as const
export const SPRINT_CRM_SCHEMA_VERSION = '1.0.0' as const

export const SPRINT_CRM_NAMESPACES = Object.freeze([
  'crm.workspace',
  'crm.leads',
  'crm.followups',
  'crm.activities',
  'crm.pipeline',
] as const)

export const SPRINT_CRM_SCOPES = Object.freeze({
  CONTEXT_READ: 'crm.context.read',
  LEADS_READ: 'crm.leads.read',
  CONTACT_DATA_READ: 'crm.contactData.read',
  FOLLOWUPS_READ: 'crm.followups.read',
  ACTIVITIES_READ: 'crm.activities.read',
  PIPELINE_READ: 'crm.pipeline.read',
} as const)

export const SPRINT_CRM_DEFAULT_PILOT_SCOPES = Object.freeze([
  SPRINT_CRM_SCOPES.CONTEXT_READ,
  SPRINT_CRM_SCOPES.LEADS_READ,
  SPRINT_CRM_SCOPES.FOLLOWUPS_READ,
  SPRINT_CRM_SCOPES.ACTIVITIES_READ,
  SPRINT_CRM_SCOPES.PIPELINE_READ,
] as const)

export const SPRINT_CRM_CAPABILITIES = Object.freeze({
  WORKSPACE_CONTEXT: 'crm.workspace.context',
  LEADS_READ: 'crm.leads.read',
  FOLLOWUPS_READ: 'crm.followups.read',
  ACTIVITIES_READ: 'crm.activities.read',
  PIPELINE_SUMMARY: 'crm.pipeline.summary',
} as const)

export const SPRINT_CRM_SEMANTIC_OPERATIONS = Object.freeze({
  WORKSPACE_GET_CONTEXT: 'crm.workspace.getContext',
  LEADS_SEARCH: 'crm.leads.search',
  LEADS_GET: 'crm.leads.get',
  LEADS_LIST_ACTION_QUEUE: 'crm.leads.listActionQueue',
  FOLLOWUPS_LIST_DUE: 'crm.followups.listDue',
  ACTIVITIES_LIST_RECENT: 'crm.activities.listRecent',
  PIPELINE_GET_SUMMARY: 'crm.pipeline.getSummary',
} as const)

export const SPRINT_CRM_MCP_TOOL_ALIASES = Object.freeze({
  'crm.workspace:get_context': 'crm_workspace__getContext',
  'crm.leads:search': 'crm_leads__search',
  'crm.leads:get': 'crm_leads__get',
  'crm.leads:list_action_queue': 'crm_leads__listActionQueue',
  'crm.followups:list_due': 'crm_followups__listDue',
  'crm.activities:list_recent': 'crm_activities__listRecent',
  'crm.pipeline:get_summary': 'crm_pipeline__getSummary',
} as const)

type InputRecord = Record<string, unknown>

function isRecord(value: unknown): value is InputRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: InputRecord, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every((key) => allowedKeys.has(key))
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 40
    && /T/u.test(value)
    && /(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && Number.isFinite(Date.parse(value))
}

function isLimit(value: unknown, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= maximum
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maximum
    && !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 31 || codePoint === 127
    })
}

function invalidInput(issue: string): SchemaValidationResult<never> {
  return { ok: false, issuesSafe: [issue] }
}

function emptyInputSchema() {
  return defineRuntimeSchema<Record<string, never>>({
    schemaId: 'crm.workspace.get-context.input',
    schemaVersion: SPRINT_CRM_SCHEMA_VERSION,
    jsonSchemaSafe: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  }, (value) => isRecord(value) && Object.keys(value).length === 0
    ? { ok: true, value: {} }
    : invalidInput('Input must be an empty object.'))
}

function leadSearchInputSchema() {
  return defineRuntimeSchema<LeadSearchInput>({
    schemaId: 'crm.leads.search.input',
    schemaVersion: SPRINT_CRM_SCHEMA_VERSION,
    jsonSchemaSafe: {
      type: 'object',
      additionalProperties: false,
      properties: {
        q: { type: 'string', minLength: 1, maxLength: CRM_READ_LIMITS.queryMaximumCharacters },
        stage: { type: 'string', enum: [...CRM_LEAD_STAGES] },
        status: { type: 'string', enum: [...CRM_LEAD_STATUSES] },
        nextAction: { type: 'string', enum: [...CRM_NEXT_ACTIONS] },
        cursor: { type: 'string', minLength: 1, maxLength: CRM_READ_LIMITS.cursorMaximumCharacters },
        limit: { type: 'integer', minimum: 1, maximum: CRM_READ_LIMITS.listMaximum },
      },
    },
  }, (value) => {
    if (!isRecord(value) || !hasOnlyKeys(value, ['q', 'stage', 'status', 'nextAction', 'cursor', 'limit'])) {
      return invalidInput('Lead search input contains unsupported fields.')
    }
    if (value.q !== undefined && !isBoundedText(value.q, CRM_READ_LIMITS.queryMaximumCharacters)) {
      return invalidInput('Lead search query is malformed.')
    }
    if (value.stage !== undefined && !CRM_LEAD_STAGES.includes(value.stage as never)) {
      return invalidInput('Lead stage is malformed.')
    }
    if (value.status !== undefined && !CRM_LEAD_STATUSES.includes(value.status as never)) {
      return invalidInput('Lead status is malformed.')
    }
    if (value.nextAction !== undefined && !CRM_NEXT_ACTIONS.includes(value.nextAction as never)) {
      return invalidInput('Next action is malformed.')
    }
    if (value.limit !== undefined && !isLimit(value.limit, CRM_READ_LIMITS.listMaximum)) {
      return invalidInput('Lead search limit is malformed.')
    }
    if (value.cursor !== undefined && !isBoundedText(value.cursor, CRM_READ_LIMITS.cursorMaximumCharacters)) {
      return invalidInput('Lead search cursor is malformed.')
    }
    const input = { ...value } as LeadSearchInput
    return isValidLeadSearchCursor(input)
      ? { ok: true, value: input }
      : invalidInput('Lead search cursor is malformed.')
  })
}

function leadGetInputSchema() {
  return defineRuntimeSchema<LeadGetInput>({
    schemaId: 'crm.leads.get.input',
    schemaVersion: SPRINT_CRM_SCHEMA_VERSION,
    jsonSchemaSafe: {
      type: 'object',
      additionalProperties: false,
      properties: { leadId: { type: 'string', format: 'uuid' } },
      required: ['leadId'],
    },
  }, (value) => isRecord(value) && hasOnlyKeys(value, ['leadId']) && isUuid(value.leadId)
    ? { ok: true, value: { leadId: value.leadId } }
    : invalidInput('Lead ID is malformed.'))
}

function actionQueueInputSchema() {
  return defineRuntimeSchema<ActionQueueInput>({
    schemaId: 'crm.leads.list-action-queue.input',
    schemaVersion: SPRINT_CRM_SCHEMA_VERSION,
    jsonSchemaSafe: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dueBefore: { type: 'string', format: 'date-time', maxLength: 40 },
        stage: { type: 'string', enum: [...CRM_ACTIVE_QUEUE_STAGES] },
        limit: { type: 'integer', minimum: 1, maximum: CRM_READ_LIMITS.listMaximum },
      },
    },
  }, (value) => {
    if (!isRecord(value) || !hasOnlyKeys(value, ['dueBefore', 'stage', 'limit'])) {
      return invalidInput('Action queue input contains unsupported fields.')
    }
    if (value.dueBefore !== undefined && !isTimestamp(value.dueBefore)) return invalidInput('dueBefore is malformed.')
    if (value.stage !== undefined && !CRM_ACTIVE_QUEUE_STAGES.includes(value.stage as never)) {
      return invalidInput('Action queue stage is malformed.')
    }
    if (value.limit !== undefined && !isLimit(value.limit, CRM_READ_LIMITS.listMaximum)) {
      return invalidInput('Action queue limit is malformed.')
    }
    return { ok: true, value: { ...value } as ActionQueueInput }
  })
}

function dueFollowupsInputSchema() {
  return defineRuntimeSchema<DueFollowupsInput>({
    schemaId: 'crm.followups.list-due.input',
    schemaVersion: SPRINT_CRM_SCHEMA_VERSION,
    jsonSchemaSafe: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dueBefore: { type: 'string', format: 'date-time', maxLength: 40 },
        stage: { type: 'string', enum: [...CRM_ACTIVE_QUEUE_STAGES] },
        cursor: { type: 'string', minLength: 1, maxLength: CRM_READ_LIMITS.cursorMaximumCharacters },
        limit: { type: 'integer', minimum: 1, maximum: CRM_READ_LIMITS.listMaximum },
      },
    },
  }, (value) => {
    if (!isRecord(value) || !hasOnlyKeys(value, ['dueBefore', 'stage', 'cursor', 'limit'])) {
      return invalidInput('Due follow-up input contains unsupported fields.')
    }
    if (value.dueBefore !== undefined && !isTimestamp(value.dueBefore)) return invalidInput('dueBefore is malformed.')
    if (value.stage !== undefined && !CRM_ACTIVE_QUEUE_STAGES.includes(value.stage as never)) {
      return invalidInput('Due follow-up stage is malformed.')
    }
    if (value.cursor !== undefined && !isBoundedText(value.cursor, CRM_READ_LIMITS.cursorMaximumCharacters)) {
      return invalidInput('Due follow-up cursor is malformed.')
    }
    if (value.limit !== undefined && !isLimit(value.limit, CRM_READ_LIMITS.listMaximum)) {
      return invalidInput('Due follow-up limit is malformed.')
    }
    const input = { ...value } as DueFollowupsInput
    return isValidDueFollowupsCursor(input)
      ? { ok: true, value: input }
      : invalidInput('Due follow-up cursor is malformed.')
  })
}

function recentActivitiesInputSchema() {
  return defineRuntimeSchema<RecentActivitiesInput>({
    schemaId: 'crm.activities.list-recent.input',
    schemaVersion: SPRINT_CRM_SCHEMA_VERSION,
    jsonSchemaSafe: {
      type: 'object',
      additionalProperties: false,
      properties: {
        leadId: { type: 'string', format: 'uuid' },
        types: {
          type: 'array',
          minItems: 1,
          maxItems: CRM_ACTIVITY_TYPES.length,
          uniqueItems: true,
          items: { type: 'string', enum: [...CRM_ACTIVITY_TYPES] },
        },
        limit: { type: 'integer', minimum: 1, maximum: CRM_READ_LIMITS.activitiesMaximum },
      },
      required: ['leadId'],
    },
  }, (value) => {
    if (!isRecord(value) || !hasOnlyKeys(value, ['leadId', 'types', 'limit']) || !isUuid(value.leadId)) {
      return invalidInput('Recent activity input is malformed.')
    }
    if (value.limit !== undefined && !isLimit(value.limit, CRM_READ_LIMITS.activitiesMaximum)) {
      return invalidInput('Recent activity limit is malformed.')
    }
    if (value.types !== undefined) {
      if (!Array.isArray(value.types) || value.types.length === 0 || value.types.length > CRM_ACTIVITY_TYPES.length) {
        return invalidInput('Activity types are malformed.')
      }
      if (
        new Set(value.types).size !== value.types.length
        || value.types.some((type) => !CRM_ACTIVITY_TYPES.includes(type as never))
      ) return invalidInput('Activity types are malformed.')
    }
    return { ok: true, value: { ...value } as unknown as RecentActivitiesInput }
  })
}

function pipelineSummaryInputSchema() {
  return defineRuntimeSchema<PipelineSummaryInput>({
    schemaId: 'crm.pipeline.get-summary.input',
    schemaVersion: SPRINT_CRM_SCHEMA_VERSION,
    jsonSchemaSafe: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: [...CRM_LEAD_STATUSES] },
        niche: { type: 'string', minLength: 1, maxLength: 300 },
        serviceInterest: { type: 'string', minLength: 1, maxLength: 500 },
      },
    },
  }, (value) => {
    if (!isRecord(value) || !hasOnlyKeys(value, ['status', 'niche', 'serviceInterest'])) {
      return invalidInput('Pipeline summary input contains unsupported fields.')
    }
    if (value.status !== undefined && !CRM_LEAD_STATUSES.includes(value.status as never)) {
      return invalidInput('Pipeline status is malformed.')
    }
    if (value.niche !== undefined && !isBoundedText(value.niche, 300)) return invalidInput('Pipeline niche is malformed.')
    if (value.serviceInterest !== undefined && !isBoundedText(value.serviceInterest, 500)) {
      return invalidInput('Pipeline service interest is malformed.')
    }
    return { ok: true, value: { ...value } as PipelineSummaryInput }
  })
}

function safeValue(value: unknown, depth = 0): value is SafeValue {
  if (depth > 12) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 100 && value.every((entry) => safeValue(entry, depth + 1))
  if (!isRecord(value) || Object.keys(value).length > 200) return false
  return Object.values(value).every((entry) => safeValue(entry, depth + 1))
}

type OutputKind = 'workspace' | 'lead_search' | 'lead_get' | 'action_queue' | 'due_followups' | 'activities' | 'pipeline'

const COMMON_OUTPUT_KEYS = ['generatedAt', 'canonicalStateVersion'] as const
const SAFE_ACTIVITY_METADATA_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  stage_changed: ['fromStage', 'toStage', 'nextAction', 'nextActionAt'],
  next_action_set: ['stage', 'nextAction', 'nextActionAt'],
  followup_scheduled: ['stage', 'nextAction', 'nextActionAt'],
  manual_edit: ['changedFields'],
  research_saved: ['version', 'source'],
  outreach_draft_saved: ['version', 'source', 'status'],
  outreach_approved: ['version'],
  reply_marked: ['replyStatus'],
})

function exactKeys(value: InputRecord, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys)
}

function stringWithin(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum
}

function nullableStringWithin(value: unknown, maximum: number): boolean {
  return value === null || stringWithin(value, maximum)
}

function validCommonOutput(value: InputRecord): boolean {
  return isTimestamp(value.generatedAt) && isBoundedText(value.canonicalStateVersion, 512)
}

const SAFE_LEAD_SUMMARY_KEYS = [
  'leadId', 'companyName', 'contactName', 'websiteDomain', 'niche', 'location',
  'serviceInterest', 'stage', 'status', 'nextAction', 'nextActionAt', 'createdAt', 'updatedAt',
] as const

function validSafeLeadSummary(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, SAFE_LEAD_SUMMARY_KEYS)) return false
  return isUuid(value.leadId)
    && isBoundedText(value.companyName, 240)
    && nullableStringWithin(value.contactName, 240)
    && nullableStringWithin(value.websiteDomain, 253)
    && nullableStringWithin(value.niche, 300)
    && nullableStringWithin(value.location, 300)
    && nullableStringWithin(value.serviceInterest, 500)
    && CRM_LEAD_STAGES.includes(value.stage as never)
    && CRM_LEAD_STATUSES.includes(value.status as never)
    && CRM_NEXT_ACTIONS.includes(value.nextAction as never)
    && isTimestamp(value.nextActionAt)
    && isTimestamp(value.createdAt)
    && isTimestamp(value.updatedAt)
}

function validPage(value: unknown): boolean {
  return isRecord(value)
    && exactKeys(value, ['hasMore', 'nextCursor'])
    && typeof value.hasMore === 'boolean'
    && (value.nextCursor === null || isBoundedText(value.nextCursor, CRM_READ_LIMITS.cursorMaximumCharacters))
    && value.hasMore === (value.nextCursor !== null)
}

function validSafeDueLead(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, [
    'leadId', 'companyName', 'contactName', 'stage', 'nextAction', 'dueAt', 'overdue', 'dueToday', 'updatedAt',
  ])) return false
  return isUuid(value.leadId)
    && isBoundedText(value.companyName, 240)
    && nullableStringWithin(value.contactName, 240)
    && CRM_LEAD_STAGES.includes(value.stage as never)
    && CRM_NEXT_ACTIONS.includes(value.nextAction as never)
    && isTimestamp(value.dueAt)
    && typeof value.overdue === 'boolean'
    && typeof value.dueToday === 'boolean'
    && isTimestamp(value.updatedAt)
}

function validActivityMetadata(type: string, value: unknown): boolean {
  if (!isRecord(value)) return false
  const allowed = SAFE_ACTIVITY_METADATA_KEYS[type] ?? []
  if (!hasOnlyKeys(value, allowed)) return false
  return Object.entries(value).every(([key, entry]) => {
    if (key === 'version') return Number.isSafeInteger(entry) && Number(entry) >= 1 && Number(entry) <= 1_000_000
    if (key === 'changedFields') {
      return Array.isArray(entry)
        && entry.length <= CRM_SAFE_MANUAL_EDIT_FIELDS.length
        && new Set(entry).size === entry.length
        && entry.every((field) => CRM_SAFE_MANUAL_EDIT_FIELDS.includes(field as never))
    }
    if (key === 'nextActionAt') return isTimestamp(entry)
    if (key === 'fromStage' || key === 'toStage' || key === 'stage') {
      return CRM_LEAD_STAGES.includes(entry as never)
    }
    if (key === 'nextAction') return CRM_NEXT_ACTIONS.includes(entry as never)
    if (key === 'source') return CRM_SAFE_ACTIVITY_SOURCES.includes(entry as never)
    if (key === 'status') return CRM_SAFE_ACTIVITY_STATUSES.includes(entry as never)
    if (key === 'replyStatus') return CRM_SAFE_REPLY_STATUSES.includes(entry as never)
    return false
  })
}

function validSafeActivity(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, ['activityId', 'leadId', 'type', 'channel', 'at', 'metadata'])) return false
  return isUuid(value.activityId)
    && isUuid(value.leadId)
    && CRM_ACTIVITY_TYPES.includes(value.type as never)
    && nullableStringWithin(value.channel, 32)
    && isTimestamp(value.at)
    && validActivityMetadata(String(value.type), value.metadata)
}

function validateOperationOutput(value: InputRecord, kind: OutputKind): boolean {
  if (!validCommonOutput(value)) return false
  if (kind === 'workspace') {
    if (!exactKeys(value, [...COMMON_OUTPUT_KEYS, 'workspace', 'capabilities']) || !isRecord(value.workspace)) return false
    const workspace = value.workspace
    const capabilities = value.capabilities
    return exactKeys(workspace, ['organizationId', 'organizationName', 'membershipRole'])
      && isUuid(workspace.organizationId)
      && isBoundedText(workspace.organizationName, 240)
      && ['owner', 'admin', 'member'].includes(String(workspace.membershipRole))
      && Array.isArray(capabilities)
      && capabilities.length === Object.keys(SPRINT_CRM_SEMANTIC_OPERATIONS).length
      && new Set(capabilities).size === capabilities.length
      && Object.values(SPRINT_CRM_SEMANTIC_OPERATIONS).every(
        (capability) => capabilities.includes(capability),
      )
  }
  if (kind === 'lead_search') {
    return exactKeys(value, [...COMMON_OUTPUT_KEYS, 'leads', 'page'])
      && Array.isArray(value.leads)
      && value.leads.length <= CRM_READ_LIMITS.listMaximum
      && value.leads.every(validSafeLeadSummary)
      && validPage(value.page)
  }
  if (kind === 'lead_get') {
    if (value.found === false) {
      return exactKeys(value, [...COMMON_OUTPUT_KEYS, 'found', 'contactDataIncluded'])
        && value.contactDataIncluded === false
    }
    if (value.found !== true || typeof value.contactDataIncluded !== 'boolean' || !isRecord(value.lead)) return false
    if (!exactKeys(value, [...COMMON_OUTPUT_KEYS, 'found', 'contactDataIncluded', 'lead'])) return false
    const lead = value.lead
    const detailKeys = [
      ...SAFE_LEAD_SUMMARY_KEYS,
      'offerType', 'lastTouchAt', 'preferredChannel', 'language', 'replyStatus', 'revenue',
      ...(value.contactDataIncluded ? ['contact'] : []),
    ]
    if (!exactKeys(lead, detailKeys) || !validSafeLeadSummary(Object.fromEntries(
      SAFE_LEAD_SUMMARY_KEYS.map((key) => [key, lead[key]]),
    ))) return false
    if (
      !nullableStringWithin(lead.offerType, 300)
      || !isTimestamp(lead.lastTouchAt)
      || !nullableStringWithin(lead.preferredChannel, 32)
      || !nullableStringWithin(lead.language, 16)
      || !nullableStringWithin(lead.replyStatus, 32)
      || !(lead.revenue === null || (typeof lead.revenue === 'number' && Number.isFinite(lead.revenue)))
    ) return false
    if (!value.contactDataIncluded) return true
    return isRecord(lead.contact)
      && exactKeys(lead.contact, ['email', 'phone'])
      && nullableStringWithin(lead.contact.email, 320)
      && nullableStringWithin(lead.contact.phone, 64)
  }
  if (kind === 'action_queue') {
    return exactKeys(value, [...COMMON_OUTPUT_KEYS, 'items', 'dueBefore', 'hasMore'])
      && Array.isArray(value.items)
      && value.items.length <= CRM_READ_LIMITS.listMaximum
      && value.items.every(validSafeDueLead)
      && isTimestamp(value.dueBefore)
      && typeof value.hasMore === 'boolean'
  }
  if (kind === 'due_followups') {
    return exactKeys(value, [...COMMON_OUTPUT_KEYS, 'representation', 'followups', 'page'])
      && value.representation === 'lead_backed_next_action'
      && Array.isArray(value.followups)
      && value.followups.length <= CRM_READ_LIMITS.listMaximum
      && value.followups.every(validSafeDueLead)
      && validPage(value.page)
  }
  if (kind === 'activities') {
    return exactKeys(value, [...COMMON_OUTPUT_KEYS, 'foundLead', 'activities', 'hasMore'])
      && typeof value.foundLead === 'boolean'
      && Array.isArray(value.activities)
      && value.activities.length <= CRM_READ_LIMITS.activitiesMaximum
      && value.activities.every(validSafeActivity)
      && typeof value.hasMore === 'boolean'
      && (value.foundLead || (value.activities.length === 0 && value.hasMore === false))
  }
  if (!exactKeys(value, [
    ...COMMON_OUTPUT_KEYS, 'status', 'filters', 'countsByStage', 'total', 'latestUpdatedAt', 'consistency',
  ])) return false
  if (!CRM_LEAD_STATUSES.includes(value.status as never) || !isRecord(value.filters) || !isRecord(value.countsByStage)) return false
  const countsByStage = value.countsByStage
  if (
    !exactKeys(value.filters, ['niche', 'serviceInterest'])
    || !nullableStringWithin(value.filters.niche, 300)
    || !nullableStringWithin(value.filters.serviceInterest, 500)
    || !exactKeys(countsByStage, CRM_LEAD_STAGES)
  ) return false
  const counts = CRM_LEAD_STAGES.map((stage) => countsByStage[stage])
  return counts.every((count) => Number.isSafeInteger(count) && Number(count) >= 0)
    && typeof value.total === 'number'
    && Number.isSafeInteger(value.total)
    && value.total === counts.reduce<number>((sum, count) => sum + Number(count), 0)
    && (value.latestUpdatedAt === null || isTimestamp(value.latestUpdatedAt))
    && value.consistency === 'bounded_multi_query_read'
}

type JsonSchemaSafe = Record<string, SafeValue>

function strictJsonObject(
  properties: JsonSchemaSafe,
  required: readonly string[] = Object.keys(properties),
): JsonSchemaSafe {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: [...required],
  }
}

function nullableStringJsonSchema(maxLength: number, format?: string): JsonSchemaSafe {
  return {
    type: ['string', 'null'],
    maxLength,
    ...(format ? { format } : {}),
  }
}

const UUID_JSON_SCHEMA: JsonSchemaSafe = {
  type: 'string',
  format: 'uuid',
  maxLength: 36,
}
const TIMESTAMP_JSON_SCHEMA: JsonSchemaSafe = {
  type: 'string',
  format: 'date-time',
  maxLength: 40,
}
const COMMON_OUTPUT_PROPERTIES: JsonSchemaSafe = {
  generatedAt: TIMESTAMP_JSON_SCHEMA,
  canonicalStateVersion: { type: 'string', minLength: 1, maxLength: 512 },
}

function safeLeadSummaryJsonProperties(): JsonSchemaSafe {
  return {
    leadId: UUID_JSON_SCHEMA,
    companyName: { type: 'string', minLength: 1, maxLength: 240 },
    contactName: nullableStringJsonSchema(240),
    websiteDomain: nullableStringJsonSchema(253),
    niche: nullableStringJsonSchema(300),
    location: nullableStringJsonSchema(300),
    serviceInterest: nullableStringJsonSchema(500),
    stage: { type: 'string', enum: [...CRM_LEAD_STAGES] },
    status: { type: 'string', enum: [...CRM_LEAD_STATUSES] },
    nextAction: { type: 'string', enum: [...CRM_NEXT_ACTIONS] },
    nextActionAt: TIMESTAMP_JSON_SCHEMA,
    createdAt: TIMESTAMP_JSON_SCHEMA,
    updatedAt: TIMESTAMP_JSON_SCHEMA,
  }
}

function safeLeadSummaryJsonSchema(): JsonSchemaSafe {
  return strictJsonObject(safeLeadSummaryJsonProperties())
}

function pageJsonSchema(): JsonSchemaSafe {
  return strictJsonObject({
    hasMore: { type: 'boolean' },
    nextCursor: nullableStringJsonSchema(CRM_READ_LIMITS.cursorMaximumCharacters),
  })
}

function safeDueLeadJsonSchema(): JsonSchemaSafe {
  return strictJsonObject({
    leadId: UUID_JSON_SCHEMA,
    companyName: { type: 'string', minLength: 1, maxLength: 240 },
    contactName: nullableStringJsonSchema(240),
    stage: { type: 'string', enum: [...CRM_LEAD_STAGES] },
    nextAction: { type: 'string', enum: [...CRM_NEXT_ACTIONS] },
    dueAt: TIMESTAMP_JSON_SCHEMA,
    overdue: { type: 'boolean' },
    dueToday: { type: 'boolean' },
    updatedAt: TIMESTAMP_JSON_SCHEMA,
  })
}

function activityMetadataJsonSchema(): JsonSchemaSafe {
  return strictJsonObject({
    fromStage: { type: 'string', enum: [...CRM_LEAD_STAGES] },
    toStage: { type: 'string', enum: [...CRM_LEAD_STAGES] },
    stage: { type: 'string', enum: [...CRM_LEAD_STAGES] },
    nextAction: { type: 'string', enum: [...CRM_NEXT_ACTIONS] },
    nextActionAt: TIMESTAMP_JSON_SCHEMA,
    changedFields: {
      type: 'array',
      uniqueItems: true,
      maxItems: CRM_SAFE_MANUAL_EDIT_FIELDS.length,
      items: { type: 'string', enum: [...CRM_SAFE_MANUAL_EDIT_FIELDS] },
    },
    version: { type: 'integer', minimum: 1, maximum: 1_000_000 },
    source: { type: 'string', enum: [...CRM_SAFE_ACTIVITY_SOURCES] },
    status: { type: 'string', enum: [...CRM_SAFE_ACTIVITY_STATUSES] },
    replyStatus: { type: 'string', enum: [...CRM_SAFE_REPLY_STATUSES] },
  }, [])
}

function safeActivityJsonSchema(): JsonSchemaSafe {
  return strictJsonObject({
    activityId: UUID_JSON_SCHEMA,
    leadId: UUID_JSON_SCHEMA,
    type: { type: 'string', enum: [...CRM_ACTIVITY_TYPES] },
    channel: nullableStringJsonSchema(32),
    at: TIMESTAMP_JSON_SCHEMA,
    metadata: activityMetadataJsonSchema(),
  })
}

function leadDetailJsonSchema(includeContactData: boolean): JsonSchemaSafe {
  return strictJsonObject({
    ...safeLeadSummaryJsonProperties(),
    offerType: nullableStringJsonSchema(300),
    lastTouchAt: TIMESTAMP_JSON_SCHEMA,
    preferredChannel: nullableStringJsonSchema(32),
    language: nullableStringJsonSchema(16),
    replyStatus: nullableStringJsonSchema(32),
    revenue: { type: ['number', 'null'] },
    ...(includeContactData ? {
      contact: strictJsonObject({
        email: nullableStringJsonSchema(320),
        phone: nullableStringJsonSchema(64),
      }),
    } : {}),
  })
}

function outputJsonSchema(kind: OutputKind): JsonSchemaSafe {
  if (kind === 'workspace') {
    return strictJsonObject({
      ...COMMON_OUTPUT_PROPERTIES,
      workspace: strictJsonObject({
        organizationId: UUID_JSON_SCHEMA,
        organizationName: { type: 'string', minLength: 1, maxLength: 240 },
        membershipRole: { type: 'string', enum: ['owner', 'admin', 'member'] },
      }),
      capabilities: {
        type: 'array',
        minItems: 7,
        maxItems: 7,
        uniqueItems: true,
        items: { type: 'string', enum: Object.values(SPRINT_CRM_SEMANTIC_OPERATIONS) },
      },
    })
  }
  if (kind === 'lead_search') {
    return strictJsonObject({
      ...COMMON_OUTPUT_PROPERTIES,
      leads: {
        type: 'array',
        maxItems: CRM_READ_LIMITS.listMaximum,
        items: safeLeadSummaryJsonSchema(),
      },
      page: pageJsonSchema(),
    })
  }
  if (kind === 'lead_get') {
    return {
      type: 'object',
      oneOf: [
        strictJsonObject({
          ...COMMON_OUTPUT_PROPERTIES,
          found: { const: false },
          contactDataIncluded: { const: false },
        }),
        strictJsonObject({
          ...COMMON_OUTPUT_PROPERTIES,
          found: { const: true },
          contactDataIncluded: { const: false },
          lead: leadDetailJsonSchema(false),
        }),
        strictJsonObject({
          ...COMMON_OUTPUT_PROPERTIES,
          found: { const: true },
          contactDataIncluded: { const: true },
          lead: leadDetailJsonSchema(true),
        }),
      ],
    }
  }
  if (kind === 'action_queue') {
    return strictJsonObject({
      ...COMMON_OUTPUT_PROPERTIES,
      items: {
        type: 'array',
        maxItems: CRM_READ_LIMITS.listMaximum,
        items: safeDueLeadJsonSchema(),
      },
      dueBefore: TIMESTAMP_JSON_SCHEMA,
      hasMore: { type: 'boolean' },
    })
  }
  if (kind === 'due_followups') {
    return strictJsonObject({
      ...COMMON_OUTPUT_PROPERTIES,
      representation: { const: 'lead_backed_next_action' },
      followups: {
        type: 'array',
        maxItems: CRM_READ_LIMITS.listMaximum,
        items: safeDueLeadJsonSchema(),
      },
      page: pageJsonSchema(),
    })
  }
  if (kind === 'activities') {
    return strictJsonObject({
      ...COMMON_OUTPUT_PROPERTIES,
      foundLead: { type: 'boolean' },
      activities: {
        type: 'array',
        maxItems: CRM_READ_LIMITS.activitiesMaximum,
        items: safeActivityJsonSchema(),
      },
      hasMore: { type: 'boolean' },
    })
  }
  return strictJsonObject({
    ...COMMON_OUTPUT_PROPERTIES,
    status: { type: 'string', enum: [...CRM_LEAD_STATUSES] },
    filters: strictJsonObject({
      niche: nullableStringJsonSchema(300),
      serviceInterest: nullableStringJsonSchema(500),
    }),
    countsByStage: strictJsonObject(Object.fromEntries(
      CRM_LEAD_STAGES.map((stage) => [stage, { type: 'integer', minimum: 0 }]),
    )),
    total: { type: 'integer', minimum: 0 },
    latestUpdatedAt: nullableStringJsonSchema(40, 'date-time'),
    consistency: { const: 'bounded_multi_query_read' },
  })
}

function outputSchema(schemaId: string, kind: OutputKind) {
  return defineRuntimeSchema<SafeValue>({
    schemaId,
    schemaVersion: SPRINT_CRM_SCHEMA_VERSION,
    jsonSchemaSafe: outputJsonSchema(kind),
  }, (value) => {
    if (!isRecord(value) || !safeValue(value)) return invalidInput('Output must be a bounded JSON-safe object.')
    if (!validateOperationOutput(value, kind)) return invalidInput('Output projection is malformed.')
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > CRM_READ_LIMITS.outputMaximumBytes) {
      return invalidInput('Output exceeds the SprintCRM bridge byte bound.')
    }
    return { ok: true, value }
  })
}

interface OperationSpec {
  readonly namespace: (typeof SPRINT_CRM_NAMESPACES)[number]
  readonly operationId: string
  readonly displayName: string
  readonly descriptionSafe: string
  readonly scope: string
  readonly capability: string
  readonly inputSchema: ReturnType<typeof emptyInputSchema>
    | ReturnType<typeof leadSearchInputSchema>
    | ReturnType<typeof leadGetInputSchema>
    | ReturnType<typeof actionQueueInputSchema>
    | ReturnType<typeof dueFollowupsInputSchema>
    | ReturnType<typeof recentActivitiesInputSchema>
    | ReturnType<typeof pipelineSummaryInputSchema>
  readonly outputKind: OutputKind
  readonly maximumItems?: number
}

const operationSpecs: readonly OperationSpec[] = [
  {
    namespace: 'crm.workspace', operationId: 'get_context', displayName: 'Get SprintCRM workspace context',
    descriptionSafe: 'Read safe context for the authenticated, organization-bound SprintCRM workspace.',
    scope: SPRINT_CRM_SCOPES.CONTEXT_READ, capability: SPRINT_CRM_CAPABILITIES.WORKSPACE_CONTEXT,
    inputSchema: emptyInputSchema(), outputKind: 'workspace',
  },
  {
    namespace: 'crm.leads', operationId: 'search', displayName: 'Search SprintCRM leads',
    descriptionSafe: 'Search a bounded page of safe lead summaries without contact or message data.',
    scope: SPRINT_CRM_SCOPES.LEADS_READ, capability: SPRINT_CRM_CAPABILITIES.LEADS_READ,
    inputSchema: leadSearchInputSchema(), outputKind: 'lead_search', maximumItems: CRM_READ_LIMITS.listMaximum,
  },
  {
    namespace: 'crm.leads', operationId: 'get', displayName: 'Get SprintCRM lead',
    descriptionSafe: 'Read one safe authoritative lead projection; contact expansion requires trusted authority.',
    scope: SPRINT_CRM_SCOPES.LEADS_READ, capability: SPRINT_CRM_CAPABILITIES.LEADS_READ,
    inputSchema: leadGetInputSchema(), outputKind: 'lead_get',
  },
  {
    namespace: 'crm.leads', operationId: 'list_action_queue', displayName: 'List SprintCRM action queue',
    descriptionSafe: 'List bounded active leads using current due and next-action semantics without a score.',
    scope: SPRINT_CRM_SCOPES.LEADS_READ, capability: SPRINT_CRM_CAPABILITIES.LEADS_READ,
    inputSchema: actionQueueInputSchema(), outputKind: 'action_queue', maximumItems: CRM_READ_LIMITS.listMaximum,
  },
  {
    namespace: 'crm.followups', operationId: 'list_due', displayName: 'List due SprintCRM follow-ups',
    descriptionSafe: 'List bounded lead-backed due next-action facts; no separate task entity is implied.',
    scope: SPRINT_CRM_SCOPES.FOLLOWUPS_READ, capability: SPRINT_CRM_CAPABILITIES.FOLLOWUPS_READ,
    inputSchema: dueFollowupsInputSchema(), outputKind: 'due_followups', maximumItems: CRM_READ_LIMITS.listMaximum,
  },
  {
    namespace: 'crm.activities', operationId: 'list_recent', displayName: 'List recent SprintCRM activities',
    descriptionSafe: 'Read a bounded lead timeline with type-specific allowlisted activity metadata.',
    scope: SPRINT_CRM_SCOPES.ACTIVITIES_READ, capability: SPRINT_CRM_CAPABILITIES.ACTIVITIES_READ,
    inputSchema: recentActivitiesInputSchema(), outputKind: 'activities', maximumItems: CRM_READ_LIMITS.activitiesMaximum,
  },
  {
    namespace: 'crm.pipeline', operationId: 'get_summary', displayName: 'Get SprintCRM pipeline summary',
    descriptionSafe: 'Read bounded server-counted totals for the six authoritative SprintCRM lead stages.',
    scope: SPRINT_CRM_SCOPES.PIPELINE_READ, capability: SPRINT_CRM_CAPABILITIES.PIPELINE_SUMMARY,
    inputSchema: pipelineSummaryInputSchema(), outputKind: 'pipeline',
  },
]

export const SPRINT_CRM_OPERATIONS: readonly ProductOperationDefinition[] = Object.freeze(
  operationSpecs.map((spec) => Object.freeze({
    operationId: spec.operationId,
    namespace: spec.namespace,
    displayName: spec.displayName,
    descriptionSafe: spec.descriptionSafe,
    operationClass: OPERATION_CLASSES.READ,
    inputSchema: spec.inputSchema,
    outputSchema: outputSchema(
      `${spec.namespace}.${spec.operationId.replaceAll('_', '-')}.output`,
      spec.outputKind,
    ),
    requiredScopes: [spec.scope],
    requiredCapabilities: [spec.capability],
    freshnessRequirement: 'NOT_REQUIRED' as const,
    idempotencyRequirement: 'NOT_SUPPORTED' as const,
    boundedOutput: {
      maxBytes: CRM_READ_LIMITS.outputMaximumBytes,
      ...(spec.maximumItems === undefined ? {} : {
        maxItems: spec.maximumItems,
        truncationSupported: true,
      }),
    },
  })),
)

const descriptorCapabilities: readonly ProductCapability[] = Object.freeze(
  Object.values(SPRINT_CRM_CAPABILITIES).map((capabilityId) => Object.freeze({
    capabilityId,
    support: 'supported' as const,
  })),
)

export const SPRINT_CRM_PRODUCT_DESCRIPTOR: ProductDescriptor = Object.freeze({
  productId: SPRINT_CRM_PRODUCT_ID,
  displayName: 'SprintCRM',
  productVersion: SPRINT_CRM_PRODUCT_VERSION,
  adapterVersion: SPRINT_CRM_ADAPTER_VERSION,
  namespaces: SPRINT_CRM_NAMESPACES,
  capabilities: descriptorCapabilities,
  schemaVersion: SPRINT_CRM_SCHEMA_VERSION,
})

function operationKey(operation: ProductOperationDefinition): string {
  return `${operation.namespace}:${operation.operationId}`
}

export class SprintCrmReadOnlyProductAdapter implements ProductAdapter {
  constructor(private readonly readModel: SprintCrmSemanticReadModel) {}

  describe(): ProductDescriptor {
    return SPRINT_CRM_PRODUCT_DESCRIPTOR
  }

  listOperations(): readonly ProductOperationDefinition[] {
    return SPRINT_CRM_OPERATIONS
  }

  async invoke(
    request: ActionRequest,
    operation: ProductOperationDefinition,
  ): Promise<ProductInvocationResult> {
    const includeContactData = request.identity.scopes.includes(SPRINT_CRM_SCOPES.CONTACT_DATA_READ)
    let result: unknown
    switch (operationKey(operation)) {
      case 'crm.workspace:get_context':
        result = await this.readModel.getWorkspaceContext()
        break
      case 'crm.leads:search':
        result = await this.readModel.searchLeads(request.input as LeadSearchInput)
        break
      case 'crm.leads:get':
        result = await this.readModel.getLead(request.input as LeadGetInput, { includeContactData })
        if (
          !includeContactData
          && (
            !isRecord(result)
            || result.contactDataIncluded !== false
            || (isRecord(result.lead) && 'contact' in result.lead)
          )
        ) {
          throw new Error('SprintCRM contact-data expansion was not authorized.')
        }
        break
      case 'crm.leads:list_action_queue':
        result = await this.readModel.listActionQueue(request.input as ActionQueueInput)
        break
      case 'crm.followups:list_due':
        result = await this.readModel.listDueFollowups(request.input as DueFollowupsInput)
        break
      case 'crm.activities:list_recent':
        result = await this.readModel.listRecentActivities(request.input as RecentActivitiesInput)
        break
      case 'crm.pipeline:get_summary':
        result = await this.readModel.getPipelineSummary(request.input as PipelineSummaryInput)
        break
      default:
        throw new Error('SprintCRM READ operation is not implemented.')
    }
    if (!isRecord(result) || !isTimestamp(result.generatedAt) || !isBoundedText(result.canonicalStateVersion, 512)) {
      throw new Error('SprintCRM read model returned invalid freshness evidence.')
    }
    return {
      status: 'completed',
      result: result as SafeValue,
      resultSnapshotId: result.canonicalStateVersion,
      validation: { state: 'not_applicable' },
      approval: { state: 'not_applicable' },
      provenance: [{
        sourceType: 'supabase_rls_read_model',
        sourceId: 'trusted-organization-binding',
        sourceVersion: result.canonicalStateVersion,
        capturedAt: result.generatedAt,
        productId: SPRINT_CRM_PRODUCT_ID,
      }],
      metadataSafe: { bounded: true, readOnly: true },
    }
  }
}

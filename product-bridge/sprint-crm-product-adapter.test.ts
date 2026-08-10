import {
  BRIDGE_ERROR_CODES,
  OPERATION_CLASSES,
  type ActionRequest,
} from '@brenych/product-bridge-contracts'
import { BridgeCore } from '@brenych/product-bridge-core'
import { ProductRegistry, validateProductOperations } from '@brenych/product-bridge-product-sdk'
import { runProductAdapterConformanceSuite } from '@brenych/product-bridge-testing'
import { describe, expect, it, vi } from 'vitest'

import {
  CRM_ACTIVITY_TYPES,
  CRM_LEAD_STAGES,
  CRM_READ_LIMITS,
  type ActionQueueInput,
  type ActionQueueResult,
  type DueFollowupsInput,
  type DueFollowupsResult,
  type LeadGetInput,
  type LeadGetResult,
  type LeadSearchInput,
  type LeadSearchResult,
  type PipelineSummaryInput,
  type PipelineSummaryResult,
  type RecentActivitiesInput,
  type RecentActivitiesResult,
  type SafeLeadSummary,
  type SprintCrmSemanticReadModel,
  type TrustedReadAccess,
  type WorkspaceContextResult,
} from './crm-read-model.js'
import { createSprintCrmConformanceFixtures } from './sprint-crm-conformance.js'
import {
  SPRINT_CRM_ADAPTER_VERSION,
  SPRINT_CRM_NAMESPACES,
  SPRINT_CRM_OPERATIONS,
  SPRINT_CRM_PRODUCT_DESCRIPTOR,
  SPRINT_CRM_PRODUCT_ID,
  SPRINT_CRM_PRODUCT_VERSION,
  SPRINT_CRM_SCHEMA_VERSION,
  SPRINT_CRM_SCOPES,
  SPRINT_CRM_SEMANTIC_OPERATIONS,
  SprintCrmReadOnlyProductAdapter,
} from './sprint-crm-product-adapter.js'

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const LEAD_ID = '22222222-2222-4222-8222-222222222222'
const ACTIVITY_ID = '33333333-3333-4333-8333-333333333333'
const GENERATED_AT = '2026-08-10T12:00:00.000Z'
const SNAPSHOT_ID = `sha256:${'a'.repeat(64)}`

const EVIDENCE = Object.freeze({
  generatedAt: GENERATED_AT,
  canonicalStateVersion: SNAPSHOT_ID,
})

const SAFE_LEAD: SafeLeadSummary = Object.freeze({
  leadId: LEAD_ID,
  companyName: 'Brenych Studio',
  contactName: 'CRM operator',
  websiteDomain: 'brenych.com',
  niche: 'creative technology',
  location: 'Madrid',
  serviceInterest: 'web application',
  stage: 'contacted',
  status: 'active',
  nextAction: 'follow_up',
  nextActionAt: '2026-08-10T14:00:00.000Z',
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-10T10:00:00.000Z',
})

function workspaceResult(): WorkspaceContextResult {
  return {
    ...EVIDENCE,
    workspace: {
      organizationId: ORGANIZATION_ID,
      organizationName: 'Brenych Studio',
      membershipRole: 'owner',
    },
    capabilities: Object.values(SPRINT_CRM_SEMANTIC_OPERATIONS),
  }
}

function searchResult(lead: SafeLeadSummary = SAFE_LEAD): LeadSearchResult {
  return {
    ...EVIDENCE,
    leads: [lead],
    page: { hasMore: false, nextCursor: null },
  }
}

function leadResult(access: TrustedReadAccess): LeadGetResult {
  return {
    ...EVIDENCE,
    found: true,
    contactDataIncluded: access.includeContactData,
    lead: {
      ...SAFE_LEAD,
      offerType: 'retainer',
      lastTouchAt: '2026-08-09T12:00:00.000Z',
      preferredChannel: 'email',
      language: 'en',
      replyStatus: 'replied',
      revenue: 5_000,
      ...(access.includeContactData ? {
        contact: { email: 'operator@example.com', phone: '+34 600 000 000' },
      } : {}),
    },
  }
}

function actionQueueResult(input: ActionQueueInput): ActionQueueResult {
  return {
    ...EVIDENCE,
    items: [{
      leadId: LEAD_ID,
      companyName: SAFE_LEAD.companyName,
      contactName: SAFE_LEAD.contactName,
      stage: SAFE_LEAD.stage,
      nextAction: SAFE_LEAD.nextAction,
      dueAt: SAFE_LEAD.nextActionAt,
      overdue: false,
      dueToday: true,
      updatedAt: SAFE_LEAD.updatedAt,
    }],
    dueBefore: input.dueBefore ?? '2026-08-10T21:59:59.999Z',
    hasMore: false,
  }
}

function dueFollowupsResult(): DueFollowupsResult {
  return {
    ...EVIDENCE,
    representation: 'lead_backed_next_action',
    followups: [{
      leadId: LEAD_ID,
      companyName: SAFE_LEAD.companyName,
      contactName: SAFE_LEAD.contactName,
      stage: SAFE_LEAD.stage,
      nextAction: SAFE_LEAD.nextAction,
      dueAt: SAFE_LEAD.nextActionAt,
      overdue: false,
      dueToday: true,
      updatedAt: SAFE_LEAD.updatedAt,
    }],
    page: { hasMore: false, nextCursor: null },
  }
}

function recentActivitiesResult(): RecentActivitiesResult {
  return {
    ...EVIDENCE,
    foundLead: true,
    activities: [{
      activityId: ACTIVITY_ID,
      leadId: LEAD_ID,
      type: 'stage_changed',
      channel: null,
      at: '2026-08-10T10:00:00.000Z',
      metadata: { fromStage: 'new', toStage: 'contacted' },
    }],
    hasMore: false,
  }
}

function pipelineSummaryResult(input: PipelineSummaryInput): PipelineSummaryResult {
  return {
    ...EVIDENCE,
    status: input.status ?? 'active',
    filters: {
      niche: input.niche ?? null,
      serviceInterest: input.serviceInterest ?? null,
    },
    countsByStage: {
      new: 2,
      contacted: 3,
      replied: 1,
      proposal: 1,
      won: 4,
      lost: 2,
    },
    total: 13,
    latestUpdatedAt: '2026-08-10T10:00:00.000Z',
    consistency: 'bounded_multi_query_read',
  }
}

function createReadModel(
  overrides: Partial<SprintCrmSemanticReadModel> = {},
): SprintCrmSemanticReadModel {
  const readModel: SprintCrmSemanticReadModel = {
    getWorkspaceContext: vi.fn(async (): Promise<WorkspaceContextResult> => workspaceResult()),
    searchLeads: vi.fn(async (): Promise<LeadSearchResult> => searchResult()),
    getLead: vi.fn(async (_input: LeadGetInput, access: TrustedReadAccess): Promise<LeadGetResult> => (
      leadResult(access)
    )),
    listActionQueue: vi.fn(async (input: ActionQueueInput): Promise<ActionQueueResult> => (
      actionQueueResult(input)
    )),
    listDueFollowups: vi.fn(async (): Promise<DueFollowupsResult> => dueFollowupsResult()),
    listRecentActivities: vi.fn(async (): Promise<RecentActivitiesResult> => recentActivitiesResult()),
    getPipelineSummary: vi.fn(async (input: PipelineSummaryInput): Promise<PipelineSummaryResult> => (
      pipelineSummaryResult(input)
    )),
  }
  return Object.assign(readModel, overrides)
}

let requestSequence = 0

async function route(
  adapter: SprintCrmReadOnlyProductAdapter,
  namespace: string,
  operationId: string,
  input: Record<string, unknown>,
  options: {
    readonly scopes?: readonly string[]
    readonly metadataSafe?: ActionRequest['metadataSafe']
  } = {},
) {
  const registry = new ProductRegistry()
  registry.registerProduct(adapter)
  const operation = registry.resolveOperation(SPRINT_CRM_PRODUCT_ID, namespace, operationId)
  requestSequence += 1
  const request: ActionRequest = {
    schemaVersion: SPRINT_CRM_SCHEMA_VERSION,
    requestId: `crm-adapter-test-${requestSequence}`,
    correlationId: `crm-adapter-correlation-${requestSequence}`,
    timestamp: GENERATED_AT,
    productId: SPRINT_CRM_PRODUCT_ID,
    namespace,
    operationId,
    operationClass: OPERATION_CLASSES.READ,
    subject: { type: 'organization', id: ORGANIZATION_ID },
    identity: {
      identityId: 'crm-adapter-test-identity',
      actor: { actorType: 'test-operator', actorId: 'crm-adapter-test' },
      productId: SPRINT_CRM_PRODUCT_ID,
      scopes: options.scopes ?? operation.requiredScopes,
      subject: ORGANIZATION_ID,
      issuedAt: GENERATED_AT,
    },
    input,
    ...(options.metadataSafe === undefined ? {} : { metadataSafe: options.metadataSafe }),
  }
  const core = new BridgeCore({
    registry,
    createId: () => `crm-core-${requestSequence}`,
    now: () => GENERATED_AT,
  })
  return core.route(request)
}

describe('SprintCrmReadOnlyProductAdapter', () => {
  it('publishes the exact SprintCRM descriptor and a bounded 7/0/0 READ profile', () => {
    const adapter = new SprintCrmReadOnlyProductAdapter(createReadModel())
    expect(adapter.describe()).toEqual(SPRINT_CRM_PRODUCT_DESCRIPTOR)
    expect(adapter.describe()).toMatchObject({
      productId: 'sprint-crm',
      displayName: 'SprintCRM',
      productVersion: SPRINT_CRM_PRODUCT_VERSION,
      adapterVersion: SPRINT_CRM_ADAPTER_VERSION,
      schemaVersion: '1.0.0',
    })
    expect(adapter.describe().namespaces).toEqual([
      'crm.workspace',
      'crm.leads',
      'crm.followups',
      'crm.activities',
      'crm.pipeline',
    ])
    expect(adapter.describe().namespaces).toEqual(SPRINT_CRM_NAMESPACES)

    const operations = adapter.listOperations()
    const validation = validateProductOperations(adapter.describe(), operations)
    expect(validation.valid, JSON.stringify(validation.issuesSafe)).toBe(true)
    expect(operations).toHaveLength(7)
    expect(operations.filter(({ operationClass }) => operationClass === OPERATION_CLASSES.READ)).toHaveLength(7)
    expect(operations.filter(({ operationClass }) => operationClass === OPERATION_CLASSES.STAGED_WRITE)).toHaveLength(0)
    expect(operations.filter(({ operationClass }) => operationClass === OPERATION_CLASSES.PRIVILEGED_ACTION)).toHaveLength(0)
    expect(operations.map(({ namespace, operationId }) => `${namespace}:${operationId}`)).toEqual([
      'crm.workspace:get_context',
      'crm.leads:search',
      'crm.leads:get',
      'crm.leads:list_action_queue',
      'crm.followups:list_due',
      'crm.activities:list_recent',
      'crm.pipeline:get_summary',
    ])
    expect(SPRINT_CRM_SEMANTIC_OPERATIONS).toEqual({
      WORKSPACE_GET_CONTEXT: 'crm.workspace.getContext',
      LEADS_SEARCH: 'crm.leads.search',
      LEADS_GET: 'crm.leads.get',
      LEADS_LIST_ACTION_QUEUE: 'crm.leads.listActionQueue',
      FOLLOWUPS_LIST_DUE: 'crm.followups.listDue',
      ACTIVITIES_LIST_RECENT: 'crm.activities.listRecent',
      PIPELINE_GET_SUMMARY: 'crm.pipeline.getSummary',
    })

    const expectedScopes = [
      SPRINT_CRM_SCOPES.CONTEXT_READ,
      SPRINT_CRM_SCOPES.LEADS_READ,
      SPRINT_CRM_SCOPES.LEADS_READ,
      SPRINT_CRM_SCOPES.LEADS_READ,
      SPRINT_CRM_SCOPES.FOLLOWUPS_READ,
      SPRINT_CRM_SCOPES.ACTIVITIES_READ,
      SPRINT_CRM_SCOPES.PIPELINE_READ,
    ]
    expect(operations.map(({ requiredScopes }) => requiredScopes)).toEqual(
      expectedScopes.map((scope) => [scope]),
    )
    expect(operations.every(({ freshnessRequirement }) => freshnessRequirement === 'NOT_REQUIRED')).toBe(true)
    expect(operations.every(({ idempotencyRequirement }) => idempotencyRequirement === 'NOT_SUPPORTED')).toBe(true)
    expect(operations.every(({ boundedOutput }) => (
      boundedOutput?.maxBytes === CRM_READ_LIMITS.outputMaximumBytes
    ))).toBe(true)
    expect(operations.map(({ boundedOutput }) => boundedOutput?.maxItems ?? null)).toEqual([
      null,
      CRM_READ_LIMITS.listMaximum,
      null,
      CRM_READ_LIMITS.listMaximum,
      CRM_READ_LIMITS.listMaximum,
      CRM_READ_LIMITS.activitiesMaximum,
      null,
    ])
  })

  it('maps all seven registered operations to the product-owned semantic read model', async () => {
    const readModel = createReadModel()
    const adapter = new SprintCrmReadOnlyProductAdapter(readModel)
    const searchInput: LeadSearchInput = { q: 'Brenych', stage: 'contacted', limit: 7 }
    const leadInput: LeadGetInput = { leadId: LEAD_ID }
    const queueInput: ActionQueueInput = { dueBefore: '2026-08-11T00:00:00.000Z', stage: 'contacted', limit: 8 }
    const followupInput: DueFollowupsInput = { dueBefore: '2026-08-11T00:00:00.000Z', stage: 'contacted', limit: 9 }
    const activitiesInput: RecentActivitiesInput = { leadId: LEAD_ID, types: ['stage_changed'], limit: 12 }
    const pipelineInput: PipelineSummaryInput = { status: 'active', niche: 'studio', serviceInterest: 'web' }
    const cases: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
      ['crm.workspace', 'get_context', {}],
      ['crm.leads', 'search', { ...searchInput }],
      ['crm.leads', 'get', { ...leadInput }],
      ['crm.leads', 'list_action_queue', { ...queueInput }],
      ['crm.followups', 'list_due', { ...followupInput }],
      ['crm.activities', 'list_recent', { ...activitiesInput }],
      ['crm.pipeline', 'get_summary', { ...pipelineInput }],
    ]

    for (const [namespace, operationId, input] of cases) {
      const result = await route(adapter, namespace, operationId, input)
      expect(result.ok, `${namespace}:${operationId} ${JSON.stringify(result)}`).toBe(true)
      if (result.ok) {
        expect(result.receipt.operationClass).toBe(OPERATION_CLASSES.READ)
        expect(result.receipt.resultSnapshotId).toBe(SNAPSHOT_ID)
      }
    }

    expect(readModel.getWorkspaceContext).toHaveBeenCalledExactlyOnceWith()
    expect(readModel.searchLeads).toHaveBeenCalledExactlyOnceWith(searchInput)
    expect(readModel.getLead).toHaveBeenCalledExactlyOnceWith(leadInput, { includeContactData: false })
    expect(readModel.listActionQueue).toHaveBeenCalledExactlyOnceWith(queueInput)
    expect(readModel.listDueFollowups).toHaveBeenCalledExactlyOnceWith(followupInput)
    expect(readModel.listRecentActivities).toHaveBeenCalledExactlyOnceWith(activitiesInput)
    expect(readModel.getPipelineSummary).toHaveBeenCalledExactlyOnceWith(pipelineInput)
  })

  it('rejects organization, user, self-grant and malformed bounded inputs before invocation', async () => {
    const readModel = createReadModel()
    const adapter = new SprintCrmReadOnlyProductAdapter(readModel)
    const cases: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
      ['crm.workspace', 'get_context', { organizationId: ORGANIZATION_ID }],
      ['crm.workspace', 'get_context', { userId: 'operator-1' }],
      ['crm.leads', 'get', { leadId: LEAD_ID, includeContactData: true }],
      ['crm.pipeline', 'get_summary', { scopes: [SPRINT_CRM_SCOPES.CONTACT_DATA_READ] }],
      ['crm.leads', 'get', { leadId: '../other-organization' }],
      ['crm.activities', 'list_recent', { leadId: 'not-a-uuid' }],
      ['crm.leads', 'search', { q: 'x'.repeat(CRM_READ_LIMITS.queryMaximumCharacters + 1) }],
      ['crm.leads', 'search', { q: 'unsafe\nquery' }],
      ['crm.leads', 'search', { limit: 0 }],
      ['crm.leads', 'search', { limit: CRM_READ_LIMITS.listMaximum + 1 }],
      ['crm.activities', 'list_recent', { leadId: LEAD_ID, types: [] }],
      ['crm.activities', 'list_recent', { leadId: LEAD_ID, types: ['won', 'won'] }],
      ['crm.activities', 'list_recent', { leadId: LEAD_ID, types: ['arbitrary_meta'] }],
      ['crm.activities', 'list_recent', { leadId: LEAD_ID, limit: CRM_READ_LIMITS.activitiesMaximum + 1 }],
    ]

    for (const [namespace, operationId, input] of cases) {
      const result = await route(adapter, namespace, operationId, input)
      expect(result, `${namespace}:${operationId} ${JSON.stringify(input)}`).toMatchObject({
        ok: false,
        error: { code: BRIDGE_ERROR_CODES.SCHEMA_INVALID },
      })
    }
    expect(readModel.getWorkspaceContext).not.toHaveBeenCalled()
    expect(readModel.getLead).not.toHaveBeenCalled()
    expect(readModel.searchLeads).not.toHaveBeenCalled()
    expect(readModel.listRecentActivities).not.toHaveBeenCalled()
    expect(readModel.getPipelineSummary).not.toHaveBeenCalled()
    expect(CRM_ACTIVITY_TYPES).toHaveLength(21)
  })

  it('derives contact expansion only from the trusted identity scope', async () => {
    const readModel = createReadModel()
    const adapter = new SprintCrmReadOnlyProductAdapter(readModel)

    const redacted = await route(adapter, 'crm.leads', 'get', { leadId: LEAD_ID })
    const metadataSelfGrant = await route(adapter, 'crm.leads', 'get', { leadId: LEAD_ID }, {
      metadataSafe: { scopes: [SPRINT_CRM_SCOPES.CONTACT_DATA_READ], includeContactData: true },
    })
    const inputSelfGrant = await route(adapter, 'crm.leads', 'get', {
      leadId: LEAD_ID,
      includeContactData: true,
    })
    const expanded = await route(adapter, 'crm.leads', 'get', { leadId: LEAD_ID }, {
      scopes: [SPRINT_CRM_SCOPES.LEADS_READ, SPRINT_CRM_SCOPES.CONTACT_DATA_READ],
    })

    expect(redacted.ok && redacted.receipt.result).toMatchObject({
      found: true,
      contactDataIncluded: false,
    })
    expect(JSON.stringify(redacted)).not.toContain('operator@example.com')
    expect(metadataSelfGrant.ok && metadataSelfGrant.receipt.result).toMatchObject({
      found: true,
      contactDataIncluded: false,
    })
    expect(JSON.stringify(metadataSelfGrant)).not.toContain('operator@example.com')
    expect(inputSelfGrant).toMatchObject({
      ok: false,
      error: { code: BRIDGE_ERROR_CODES.SCHEMA_INVALID },
    })
    expect(expanded.ok && expanded.receipt.result).toMatchObject({
      found: true,
      contactDataIncluded: true,
      lead: { contact: { email: 'operator@example.com', phone: '+34 600 000 000' } },
    })
    expect(readModel.getLead).toHaveBeenNthCalledWith(1, { leadId: LEAD_ID }, { includeContactData: false })
    expect(readModel.getLead).toHaveBeenNthCalledWith(2, { leadId: LEAD_ID }, { includeContactData: false })
    expect(readModel.getLead).toHaveBeenNthCalledWith(3, { leadId: LEAD_ID }, { includeContactData: true })
  })

  it('fails closed if a regressed read model expands contact data without trusted scope', async () => {
    const adapter = new SprintCrmReadOnlyProductAdapter(createReadModel({
      getLead: vi.fn(async (): Promise<LeadGetResult> => leadResult({ includeContactData: true })),
    }))

    const result = await route(adapter, 'crm.leads', 'get', { leadId: LEAD_ID })
    expect(result).toMatchObject({
      ok: false,
      error: { code: BRIDGE_ERROR_CODES.PRODUCT_UNAVAILABLE },
    })
    expect(JSON.stringify(result)).not.toContain('operator@example.com')
    expect(JSON.stringify(result)).not.toContain('+34 600 000 000')
  })

  it('fails closed on missing scopes, metadata self-grant and output byte-bound violations', async () => {
    const adapter = new SprintCrmReadOnlyProductAdapter(createReadModel())
    const missingScope = await route(adapter, 'crm.leads', 'search', {}, { scopes: [] })
    const metadataSelfGrant = await route(adapter, 'crm.leads', 'search', {}, {
      scopes: [],
      metadataSafe: { scopes: [SPRINT_CRM_SCOPES.LEADS_READ] },
    })
    expect(missingScope).toMatchObject({
      ok: false,
      error: { code: BRIDGE_ERROR_CODES.SCOPE_DENIED },
    })
    expect(metadataSelfGrant).toMatchObject({
      ok: false,
      error: { code: BRIDGE_ERROR_CODES.SCOPE_DENIED },
    })

    const oversizedLead = {
      ...SAFE_LEAD,
      companyName: 'x'.repeat(CRM_READ_LIMITS.outputMaximumBytes),
    }
    const oversizedAdapter = new SprintCrmReadOnlyProductAdapter(createReadModel({
      searchLeads: vi.fn(async (): Promise<LeadSearchResult> => searchResult(oversizedLead)),
    }))
    const oversized = await route(oversizedAdapter, 'crm.leads', 'search', {})
    expect(oversized).toMatchObject({
      ok: false,
      error: { code: BRIDGE_ERROR_CODES.INTERNAL_SAFE_FAILURE },
    })
    expect(JSON.stringify(oversized)).not.toContain('x'.repeat(200))
  })

  it('fails closed when a regressed read model adds non-allowlisted output fields', async () => {
    const privateNote = 'private-note-output-sentinel'
    const accessToken = 'access-token-output-sentinel'
    const regressedResult = {
      ...searchResult(),
      accessToken,
      leads: [{ ...SAFE_LEAD, notes: privateNote }],
    } as unknown as LeadSearchResult
    const adapter = new SprintCrmReadOnlyProductAdapter(createReadModel({
      searchLeads: vi.fn(async (): Promise<LeadSearchResult> => regressedResult),
    }))

    const result = await route(adapter, 'crm.leads', 'search', {})
    const serialized = JSON.stringify(result)
    expect(result).toMatchObject({
      ok: false,
      error: { code: BRIDGE_ERROR_CODES.INTERNAL_SAFE_FAILURE },
    })
    expect(serialized).not.toContain(privateNote)
    expect(serialized).not.toContain(accessToken)
  })

  it('passes Shared READ-only conformance with the exact 7/0/0 operation profile', async () => {
    const adapter = new SprintCrmReadOnlyProductAdapter(createReadModel())
    const fixtures = createSprintCrmConformanceFixtures(ORGANIZATION_ID)
    const report = await runProductAdapterConformanceSuite({
      adapter,
      fixtures,
      expectations: {
        expectedProductId: SPRINT_CRM_PRODUCT_ID,
        expectedOperationClasses: [OPERATION_CLASSES.READ],
      },
    })

    expect(report.passed, JSON.stringify(report.checks.filter(({ passed }) => !passed))).toBe(true)
    expect(report.operationClassProfile).toEqual({
      operationClasses: [OPERATION_CLASSES.READ],
      readOperationCount: 7,
      stagedWriteOperationCount: 0,
      privilegedActionOperationCount: 0,
    })
    expect(fixtures).not.toHaveProperty('validStagedWrite')
    expect(fixtures).not.toHaveProperty('validPrivilegedAction')
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkId: 'read-receipt', passed: true }),
      expect.objectContaining({ checkId: 'staged-write-absent', passed: true }),
      expect.objectContaining({ checkId: 'privileged-action-absent', passed: true }),
      expect.objectContaining({ checkId: 'missing-scope', passed: true }),
      expect.objectContaining({ checkId: 'metadata-cannot-grant-scope', passed: true }),
      expect.objectContaining({ checkId: 'product-isolation', passed: true }),
      expect.objectContaining({ checkId: 'subject-isolation', passed: true }),
      expect.objectContaining({ checkId: 'safe-adapter-error', passed: true }),
      expect.objectContaining({ checkId: 'safe-audit-metadata', passed: true }),
    ]))
    expect(SPRINT_CRM_OPERATIONS).toHaveLength(7)
    expect(CRM_LEAD_STAGES).toEqual(['new', 'contacted', 'replied', 'proposal', 'won', 'lost'])
  })
})

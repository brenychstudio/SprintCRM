import {
  BRIDGE_ERROR_CODES,
  OPERATION_CLASSES,
  type ActionRequest,
  type ActionReceipt,
} from '@brenych/product-bridge-contracts'
import { describe, expect, it } from 'vitest'

import type { VerifiedSprintCrmAuthority } from './authenticated-supabase-runtime.js'
import type { SprintCrmSemanticReadModel } from './crm-read-model.js'
import type {
  ClaimInput,
  CommitEmailDraftInput,
  CommitResearchInput,
  CrmStagedWriteDomainGateway,
} from './crm-staged-write-domain-gateway.js'
import { durableReceiptsAreJsonEquivalent } from './crm-staged-write-coordinator.js'
import type { CrmStagingContext } from './crm-staging-context.js'
import { createSprintCrmMcpRuntime } from './sprint-crm-mcp-runtime.js'
import {
  SPRINT_CRM_PRODUCT_ID,
  SPRINT_CRM_SCHEMA_VERSION,
  SPRINT_CRM_SCOPES,
  SPRINT_CRM_SEMANTIC_OPERATIONS,
} from './sprint-crm-product-adapter.js'

const NOW = '2026-08-11T12:00:00.000Z'
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const CAMPAIGN_MEMBER_ID = '44444444-4444-4444-8444-444444444444'
const CAMPAIGN_ID = '55555555-5555-4555-8555-555555555555'
const RESEARCH_ID = '66666666-6666-4666-8666-666666666666'
const FRESHNESS = `sha256:${'a'.repeat(64)}` as const
const STALE_FRESHNESS = `sha256:${'b'.repeat(64)}` as const

function equalityReceipt(overrides: Record<string, unknown> = {}): ActionReceipt {
  return {
    schemaVersion: SPRINT_CRM_SCHEMA_VERSION,
    receiptId: 'receipt-json-equivalence',
    requestId: 'request-json-equivalence',
    correlationId: 'correlation-json-equivalence',
    productId: SPRINT_CRM_PRODUCT_ID,
    operationId: 'stage_draft',
    operationClass: OPERATION_CLASSES.STAGED_WRITE,
    status: 'staged',
    timestamp: NOW,
    result: {
      entityType: 'outbound_message',
      entityId: '77777777-7777-4777-8777-777777777777',
      version: 1,
    },
    validation: { state: 'pending' },
    approval: { state: 'pending' },
    ...overrides,
  } as ActionReceipt
}

interface DurableClaim {
  readonly fingerprint: string
  readonly claimToken: string
  receipt?: ActionReceipt
}

class FakeDurableStagingGateway implements CrmStagedWriteDomainGateway {
  readonly claims = new Map<string, DurableClaim>()
  readonly claimInputs: ClaimInput[] = []
  readonly researchEffects: CommitResearchInput[] = []
  readonly emailEffects: CommitEmailDraftInput[] = []
  contextReads = 0
  releases = 0
  failContext = false
  failCommitAsStale = false
  roundTripCommitReceiptsThroughJson = false

  constructor(readonly context: CrmStagingContext = stagingContext()) {}

  async getStagingContext(campaignMemberId: string): Promise<CrmStagingContext> {
    this.contextReads += 1
    if (this.failContext || campaignMemberId !== this.context.campaignMember.id) {
      throw new Error('Unavailable.')
    }
    return structuredClone(this.context)
  }

  async claim(input: ClaimInput) {
    this.claimInputs.push(structuredClone(input))
    const key = this.key(input.operationId, input.idempotencyKey)
    const existing = this.claims.get(key)
    if (!existing) {
      this.claims.set(key, { fingerprint: input.semanticFingerprint, claimToken: input.claimToken })
      return {
        outcome: 'CLAIMED' as const,
        requestLedgerId: '77777777-7777-4777-8777-777777777777',
        leaseExpiresAt: NOW,
      }
    }
    if (existing.fingerprint !== input.semanticFingerprint) return { outcome: 'CONFLICT' as const }
    if (!existing.receipt) return { outcome: 'IN_PROGRESS' as const }
    return { outcome: 'REPLAY' as const, receipt: existing.receipt as never }
  }

  async release(input: Omit<ClaimInput, 'leaseSeconds' | 'provenance'>): Promise<boolean> {
    const key = this.key(input.operationId, input.idempotencyKey)
    const existing = this.claims.get(key)
    if (!existing || existing.fingerprint !== input.semanticFingerprint
        || existing.claimToken !== input.claimToken || existing.receipt) return false
    this.claims.delete(key)
    this.releases += 1
    return true
  }

  async commitResearch(input: CommitResearchInput) {
    if (this.failCommitAsStale) {
      return { outcome: 'STALE' as const, currentFreshness: this.context.freshness.version }
    }
    this.researchEffects.push(structuredClone(input))
    const receipt = this.persistedReceipt(input.receipt)
    this.complete('crm.research.stageSnapshot', input.idempotencyKey, receipt as unknown as ActionReceipt)
    return {
      outcome: 'COMPLETED' as const,
      receipt,
      stagedEntity: {
        type: 'research_snapshot', id: input.stagedEntityId,
        version: input.expectedVersion, status: 'research_ready',
      },
    }
  }

  async commitEmailDraft(input: CommitEmailDraftInput) {
    if (this.failCommitAsStale) {
      return { outcome: 'STALE' as const, currentFreshness: this.context.freshness.version }
    }
    this.emailEffects.push(structuredClone(input))
    const receipt = this.persistedReceipt(input.receipt)
    this.complete('crm.email.stageDraft', input.idempotencyKey, receipt as unknown as ActionReceipt)
    return {
      outcome: 'COMPLETED' as const,
      receipt,
      stagedEntity: {
        type: 'outbound_message', id: input.stagedEntityId,
        version: input.expectedVersion, status: 'draft',
      },
    }
  }

  private key(operationId: string, idempotencyKey: string): string {
    return `${operationId}\u0000${idempotencyKey}`
  }

  private complete(operationId: string, idempotencyKey: string, receipt: ActionReceipt): void {
    const key = this.key(operationId, idempotencyKey)
    const existing = this.claims.get(key)
    if (!existing) throw new Error('Missing claim.')
    existing.receipt = structuredClone(receipt)
  }

  private persistedReceipt<T>(receipt: T): T {
    if (!this.roundTripCommitReceiptsThroughJson) return receipt
    return JSON.parse(JSON.stringify(receipt)) as T
  }
}

function stagingContext(): CrmStagingContext {
  return {
    organizationId: ORGANIZATION_ID,
    actorSubject: `user:${USER_ID}`,
    campaignMember: { id: CAMPAIGN_MEMBER_ID, status: 'research_ready', updatedAt: NOW },
    campaign: { id: CAMPAIGN_ID, channel: 'email', defaultLanguage: 'en', updatedAt: NOW },
    lead: { language: 'en', updatedAt: NOW },
    latestResearch: { id: RESEARCH_ID, version: 2, createdAt: NOW },
    latestOutboundMessage: null,
    freshness: {
      subjectType: 'campaign_member_staging_context',
      subjectId: CAMPAIGN_MEMBER_ID,
      version: FRESHNESS,
      generatedAt: NOW,
    },
  }
}

function authority(): VerifiedSprintCrmAuthority {
  return {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    organizationName: 'Brenych Studio',
    membershipRole: 'owner',
    verifiedAt: NOW,
  }
}

function readModel(): SprintCrmSemanticReadModel {
  const evidence = { generatedAt: NOW, canonicalStateVersion: FRESHNESS }
  return {
    getWorkspaceContext: async () => ({
      ...evidence,
      workspace: { organizationId: ORGANIZATION_ID, organizationName: 'Brenych Studio', membershipRole: 'owner' },
      capabilities: Object.values(SPRINT_CRM_SEMANTIC_OPERATIONS),
    }),
    searchLeads: async () => ({ ...evidence, leads: [], page: { hasMore: false, nextCursor: null } }),
    getLead: async () => ({ ...evidence, found: false, contactDataIncluded: false }),
    listActionQueue: async () => ({ ...evidence, items: [], dueBefore: NOW, hasMore: false }),
    listDueFollowups: async () => ({
      ...evidence, representation: 'lead_backed_next_action',
      followups: [], page: { hasMore: false, nextCursor: null },
    }),
    listRecentActivities: async () => ({ ...evidence, foundLead: true, activities: [], hasMore: false }),
    getPipelineSummary: async () => ({
      ...evidence,
      status: 'active', filters: { niche: null, serviceInterest: null },
      countsByStage: { new: 0, contacted: 0, replied: 0, proposal: 0, won: 0, lost: 0 },
      total: 0, latestUpdatedAt: null, consistency: 'bounded_multi_query_read',
    }),
  }
}

let requestNumber = 0

function baseRequest(options: {
  namespace: string
  operationId: string
  operationClass: 'READ' | 'STAGED_WRITE'
  scope: string
  input: Record<string, unknown>
  idempotencyKey?: string
  sourceSnapshotId?: string
  subjectId?: string
}): ActionRequest {
  requestNumber += 1
  const subjectId = options.subjectId ?? ORGANIZATION_ID
  return {
    schemaVersion: SPRINT_CRM_SCHEMA_VERSION,
    requestId: `crm-staging-request-${requestNumber}`,
    correlationId: `crm-staging-correlation-${requestNumber}`,
    timestamp: NOW,
    productId: SPRINT_CRM_PRODUCT_ID,
    namespace: options.namespace,
    operationId: options.operationId,
    operationClass: options.operationClass,
    subject: { type: 'organization', id: subjectId },
    identity: {
      identityId: `crm-staging-identity-${requestNumber}`,
      actor: { actorType: 'authenticated-user', actorId: USER_ID },
      productId: SPRINT_CRM_PRODUCT_ID,
      scopes: [options.scope],
      subject: subjectId,
      issuedAt: NOW,
    },
    input: options.input,
    ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
    ...(options.sourceSnapshotId === undefined ? {} : {
      sourceSnapshot: { snapshotId: options.sourceSnapshotId, generatedAt: NOW },
    }),
  }
}

function researchRequest(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    ...baseRequest({
      namespace: 'crm.research', operationId: 'stage_snapshot',
      operationClass: OPERATION_CLASSES.STAGED_WRITE, scope: SPRINT_CRM_SCOPES.RESEARCH_STAGE,
      idempotencyKey: 'research-stage-key-1', sourceSnapshotId: FRESHNESS,
      input: {
        campaignMemberId: CAMPAIGN_MEMBER_ID,
        observedOpportunity: 'The current public site has a concrete conversion opportunity for qualified traffic.',
        recommendedOffer: 'A focused conversion audit followed by one measurable implementation sprint.',
        evidence: [{
          url: 'https://example.test/research',
          note: 'The public service flow requires several steps before a visitor can make contact.',
        }],
        recommendedCase: null,
        confidence: 0.8,
        warnings: [],
      },
    }),
    ...overrides,
  }
}

function emailRequest(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    ...baseRequest({
      namespace: 'crm.email', operationId: 'stage_draft',
      operationClass: OPERATION_CLASSES.STAGED_WRITE, scope: SPRINT_CRM_SCOPES.EMAIL_STAGE,
      idempotencyKey: 'email-stage-key-1', sourceSnapshotId: FRESHNESS,
      input: {
        campaignMemberId: CAMPAIGN_MEMBER_ID,
        researchSnapshotId: RESEARCH_ID,
        subject: 'A focused improvement for your inquiry flow',
        body: 'Hello, I reviewed the public inquiry path and found a concrete way to reduce friction for qualified visitors. I prepared one focused recommendation for your review before any outreach is sent.',
        language: 'en',
      },
    }),
    ...overrides,
  }
}

function runtime(gateway: FakeDurableStagingGateway, scopes: readonly string[]) {
  let id = 0
  return createSprintCrmMcpRuntime({
    readModel: readModel(), stagedWriteGateway: gateway, authority: authority(), scopes,
    now: () => NOW, createId: () => `crm-staging-test-id-${id += 1}`,
  })
}

describe('durable receipt JSON equivalence', () => {
  it('treats absent optional object properties and undefined optional properties as equal', () => {
    expect(durableReceiptsAreJsonEquivalent(
      equalityReceipt({ metadataSafe: undefined }),
      equalityReceipt(),
    )).toBe(true)
    expect(durableReceiptsAreJsonEquivalent(
      equalityReceipt({ validation: { state: 'pending', diagnosticsSafe: undefined } }),
      equalityReceipt({ validation: { state: 'pending' } }),
    )).toBe(true)
  })

  it.each([
    ['null', null],
    ['false', false],
    ['zero', 0],
    ['empty string', ''],
  ])('preserves a meaningful %s value rather than treating it as absent', (_label, value) => {
    expect(durableReceiptsAreJsonEquivalent(
      equalityReceipt({ metadataSafe: { meaningful: value } }),
      equalityReceipt({ metadataSafe: {} }),
    )).toBe(false)
  })

  it('preserves receipt identity, effect identity, nested values, and array order', () => {
    expect(durableReceiptsAreJsonEquivalent(
      equalityReceipt({ receiptId: 'receipt-one' }),
      equalityReceipt({ receiptId: 'receipt-two' }),
    )).toBe(false)
    expect(durableReceiptsAreJsonEquivalent(
      equalityReceipt({ result: { entityId: '77777777-7777-4777-8777-777777777777', version: 1 } }),
      equalityReceipt({ result: { entityId: '88888888-8888-4888-8888-888888888888', version: 1 } }),
    )).toBe(false)
    expect(durableReceiptsAreJsonEquivalent(
      equalityReceipt({ result: { entityId: '77777777-7777-4777-8777-777777777777', version: 1 } }),
      equalityReceipt({ result: { entityId: '77777777-7777-4777-8777-777777777777', version: 2 } }),
    )).toBe(false)
    expect(durableReceiptsAreJsonEquivalent(
      equalityReceipt({ diagnosticsSafe: ['first', 'second'] }),
      equalityReceipt({ diagnosticsSafe: ['second', 'first'] }),
    )).toBe(false)
  })

  it('ignores plain-object insertion order while retaining every meaningful key', () => {
    expect(durableReceiptsAreJsonEquivalent(
      equalityReceipt({ metadataSafe: { alpha: 1, beta: 2 } }),
      equalityReceipt({ metadataSafe: { beta: 2, alpha: 1 } }),
    )).toBe(true)
    expect(durableReceiptsAreJsonEquivalent(
      equalityReceipt({ metadataSafe: { alpha: 1, beta: 2 } }),
      equalityReceipt({ metadataSafe: { alpha: 1, beta: 3 } }),
    )).toBe(false)
  })

  it.each([
    ['non-finite number', Number.NaN],
    ['bigint', BigInt(1)],
    ['function', () => 'not JSON'],
    ['symbol', Symbol('not-json')],
    ['Date', new Date(NOW)],
  ])('fails closed for unsupported JSON value: %s', (_label, value) => {
    expect(durableReceiptsAreJsonEquivalent(
      equalityReceipt({ metadataSafe: { unsupported: value } }),
      equalityReceipt({ metadataSafe: { unsupported: value } }),
    )).toBe(false)
  })

  it('fails closed for sparse arrays and cyclic objects', () => {
    const sparse = new Array<unknown>(1)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    expect(durableReceiptsAreJsonEquivalent(
      equalityReceipt({ diagnosticsSafe: sparse }),
      equalityReceipt({ diagnosticsSafe: sparse }),
    )).toBe(false)
    expect(durableReceiptsAreJsonEquivalent(
      equalityReceipt({ metadataSafe: cyclic }),
      equalityReceipt({ metadataSafe: cyclic }),
    )).toBe(false)
  })
})

describe('SprintCRM staged-write coordinator', () => {
  it('stages one research snapshot and preserves the exact Shared receipt and trusted provenance', async () => {
    const gateway = new FakeDurableStagingGateway()
    const request = researchRequest()
    const result = await runtime(gateway, [SPRINT_CRM_SCOPES.RESEARCH_STAGE]).core.route(request)

    expect(result).toMatchObject({
      ok: true,
      receipt: {
        requestId: request.requestId,
        operationId: 'stage_snapshot',
        operationClass: 'STAGED_WRITE',
        status: 'staged',
        sourceSnapshotId: FRESHNESS,
        result: {
          entityType: 'research_snapshot', version: 3,
          status: 'research_ready', campaignMemberId: CAMPAIGN_MEMBER_ID,
        },
        validation: { state: 'pending' },
        approval: { state: 'pending' },
      },
    })
    expect(gateway.researchEffects).toHaveLength(1)
    expect(gateway.emailEffects).toHaveLength(0)
    expect(gateway.researchEffects[0]?.receipt).toEqual(result.ok ? result.receipt : undefined)
    expect(gateway.researchEffects[0]).toMatchObject({
      campaignMemberId: CAMPAIGN_MEMBER_ID,
      sourceSnapshotId: FRESHNESS,
      expectedVersion: 3,
      provenance: {
        productId: 'sprint-crm', operationId: 'crm.research.stageSnapshot',
        requestId: request.requestId, actorSubject: `user:${USER_ID}`,
        organizationId: ORGANIZATION_ID, campaignMemberId: CAMPAIGN_MEMBER_ID,
      },
    })
    expect(gateway.claimInputs[0]?.semanticFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(JSON.stringify(gateway.claimInputs[0])).not.toContain('observedOpportunity')
  })

  it('replays the exact durable research receipt before freshness and rejects a changed request', async () => {
    const gateway = new FakeDurableStagingGateway()
    const firstRequest = researchRequest()
    const first = await runtime(gateway, [SPRINT_CRM_SCOPES.RESEARCH_STAGE]).core.route(firstRequest)
    const contextReadsAfterFirst = gateway.contextReads
    const replay = await runtime(gateway, [SPRINT_CRM_SCOPES.RESEARCH_STAGE]).core.route(researchRequest({
      requestId: 'research-replay-request', correlationId: 'research-replay-correlation',
      identity: { ...firstRequest.identity, identityId: 'research-replay-identity' },
    }))
    const conflict = await runtime(gateway, [SPRINT_CRM_SCOPES.RESEARCH_STAGE]).core.route(researchRequest({
      requestId: 'research-conflict-request', correlationId: 'research-conflict-correlation',
      input: {
        ...(firstRequest.input as Record<string, unknown>),
        recommendedOffer: 'A materially different implementation engagement that must not reuse the durable key.',
      },
    }))

    expect(first.ok).toBe(true)
    expect(replay).toEqual(first)
    expect(gateway.contextReads).toBe(contextReadsAfterFirst)
    expect(gateway.researchEffects).toHaveLength(1)
    expect(conflict).toMatchObject({ ok: false, error: { code: BRIDGE_ERROR_CODES.DUPLICATE_REQUEST } })
    expect(gateway.researchEffects).toHaveLength(1)
  })

  it('serializes concurrent equivalent requests to one prepared product effect', async () => {
    const gateway = new FakeDurableStagingGateway()
    const bridge = runtime(gateway, [SPRINT_CRM_SCOPES.RESEARCH_STAGE])
    const firstRequest = researchRequest({ idempotencyKey: 'research-concurrent-key' })
    const secondRequest = researchRequest({
      requestId: 'research-concurrent-second',
      correlationId: 'research-concurrent-second-correlation',
      idempotencyKey: 'research-concurrent-key',
      input: firstRequest.input,
      sourceSnapshot: firstRequest.sourceSnapshot,
    })

    const results = await Promise.all([
      bridge.core.route(firstRequest),
      bridge.core.route(secondRequest),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok && result.error.code === BRIDGE_ERROR_CODES.DUPLICATE_REQUEST))
      .toHaveLength(1)
    expect(gateway.researchEffects).toHaveLength(1)
  })

  it('releases a stale or unknown new claim and creates zero effects', async () => {
    const staleGateway = new FakeDurableStagingGateway()
    const staleRequest = researchRequest({
      idempotencyKey: 'research-stale-key',
      sourceSnapshot: { snapshotId: STALE_FRESHNESS, generatedAt: NOW },
    })
    const stale = await runtime(staleGateway, [SPRINT_CRM_SCOPES.RESEARCH_STAGE]).core.route(staleRequest)
    expect(stale).toMatchObject({ ok: false, error: { code: BRIDGE_ERROR_CODES.STALE_CONTEXT } })
    expect(staleGateway.releases).toBe(1)
    expect(staleGateway.researchEffects).toHaveLength(0)

    const unknownGateway = new FakeDurableStagingGateway()
    unknownGateway.failContext = true
    const unknown = await runtime(unknownGateway, [SPRINT_CRM_SCOPES.RESEARCH_STAGE]).core.route(
      researchRequest({ idempotencyKey: 'research-unknown-key' }),
    )
    expect(unknown).toMatchObject({ ok: false, error: { code: BRIDGE_ERROR_CODES.STALE_CONTEXT } })
    expect(unknownGateway.releases).toBe(1)
    expect(unknownGateway.researchEffects).toHaveLength(0)
  })

  it('rejects a caller-supplied wrong organization before claim or effect', async () => {
    const gateway = new FakeDurableStagingGateway()
    const result = await runtime(gateway, [SPRINT_CRM_SCOPES.RESEARCH_STAGE]).core.route(
      researchRequest({
        subject: { type: 'organization', id: OTHER_ORGANIZATION_ID },
        identity: {
          ...researchRequest().identity,
          subject: OTHER_ORGANIZATION_ID,
        },
      }),
    )
    expect(result).toMatchObject({ ok: false, error: { code: BRIDGE_ERROR_CODES.INVALID_REQUEST } })
    expect(gateway.claimInputs).toHaveLength(0)
    expect(gateway.researchEffects).toHaveLength(0)
  })

  it('stages one draft, keeps it pending, and replays without a second message version', async () => {
    const gateway = new FakeDurableStagingGateway()
    const bridge = runtime(gateway, [SPRINT_CRM_SCOPES.EMAIL_STAGE])
    const firstRequest = emailRequest()
    const first = await bridge.core.route(firstRequest)
    const replay = await bridge.core.route(emailRequest({
      requestId: 'email-replay-request', correlationId: 'email-replay-correlation',
      identity: { ...firstRequest.identity, identityId: 'email-replay-identity' },
    }))
    const conflict = await bridge.core.route(emailRequest({
      requestId: 'email-conflict-request', correlationId: 'email-conflict-correlation',
      input: {
        ...(firstRequest.input as Record<string, unknown>),
        body: 'Hello, this is a changed but still bounded draft body. It must conflict with the already completed semantic request and must never create another outbound message version.',
      },
    }))

    expect(first).toMatchObject({
      ok: true,
      receipt: {
        operationId: 'stage_draft', operationClass: 'STAGED_WRITE', status: 'staged',
        result: {
          entityType: 'outbound_message', version: 1, status: 'draft',
          campaignMemberId: CAMPAIGN_MEMBER_ID,
          researchSnapshotId: RESEARCH_ID, researchVersion: 2,
        },
        validation: { state: 'pending' }, approval: { state: 'pending' },
      },
    })
    expect(replay).toEqual(first)
    expect(conflict).toMatchObject({ ok: false, error: { code: BRIDGE_ERROR_CODES.DUPLICATE_REQUEST } })
    expect(gateway.emailEffects).toHaveLength(1)
    expect(gateway.researchEffects).toHaveLength(0)
    expect(gateway.emailEffects[0]).toMatchObject({
      campaignMemberId: CAMPAIGN_MEMBER_ID,
      researchSnapshotId: RESEARCH_ID,
      expectedVersion: 1,
      provenance: { operationId: 'crm.email.stageDraft', actorSubject: `user:${USER_ID}` },
    })
    const serialized = JSON.stringify({ result: first, effect: gateway.emailEffects[0] })
    expect(serialized).not.toMatch(/approved_by|approvedAt|sent_at|provider|gmail|ai_generations/iu)
  })

  it('accepts the exact Shared receipt after a JSONB-equivalent persistence roundtrip', async () => {
    const gateway = new FakeDurableStagingGateway()
    gateway.roundTripCommitReceiptsThroughJson = true
    const result = await runtime(gateway, [SPRINT_CRM_SCOPES.EMAIL_STAGE]).core.route(
      emailRequest({ idempotencyKey: 'email-json-roundtrip-key' }),
    )

    const originalReceipt = gateway.emailEffects[0]?.receipt as unknown as Record<string, unknown>
    expect(Object.keys(originalReceipt).filter((key) => originalReceipt[key] === undefined)).toEqual([
      'resultSnapshotId',
      'provenance',
      'diagnosticsSafe',
      'metadataSafe',
    ])
    const persistedReceipt = JSON.parse(JSON.stringify(originalReceipt)) as Record<string, unknown>
    expect(Object.hasOwn(persistedReceipt, 'resultSnapshotId')).toBe(false)
    expect(Object.hasOwn(persistedReceipt, 'provenance')).toBe(false)
    expect(Object.hasOwn(persistedReceipt, 'diagnosticsSafe')).toBe(false)
    expect(Object.hasOwn(persistedReceipt, 'metadataSafe')).toBe(false)
    expect(result).toMatchObject({ ok: true, receipt: { status: 'staged' } })
    expect(gateway.emailEffects).toHaveLength(1)
  })

  it('fails closed on a transactional commit-time stale result and releases the pending claim', async () => {
    const gateway = new FakeDurableStagingGateway()
    gateway.failCommitAsStale = true
    const result = await runtime(gateway, [SPRINT_CRM_SCOPES.EMAIL_STAGE]).core.route(
      emailRequest({ idempotencyKey: 'email-commit-stale-key' }),
    )
    expect(result).toMatchObject({ ok: false, error: { code: BRIDGE_ERROR_CODES.INTERNAL_SAFE_FAILURE } })
    expect(gateway.emailEffects).toHaveLength(0)
    expect(gateway.releases).toBe(1)
  })

  it('returns a bounded content-free staging context and binds the transport default subject', async () => {
    const gateway = new FakeDurableStagingGateway()
    const request = baseRequest({
      namespace: 'crm.outreach', operationId: 'get_staging_context',
      operationClass: OPERATION_CLASSES.READ, scope: SPRINT_CRM_SCOPES.OUTREACH_READ,
      input: { campaignMemberId: CAMPAIGN_MEMBER_ID },
    })
    const result = await runtime(gateway, [SPRINT_CRM_SCOPES.OUTREACH_READ]).core.route({
      ...request,
      subject: { type: 'product', id: SPRINT_CRM_PRODUCT_ID },
      identity: { ...request.identity, subject: undefined },
    })
    expect(result).toMatchObject({
      ok: true,
      receipt: {
        operationClass: 'READ', status: 'completed',
        result: {
          campaignMember: { id: CAMPAIGN_MEMBER_ID, status: 'research_ready' },
          latestResearch: { id: RESEARCH_ID, version: 2 },
          freshness: { version: FRESHNESS, subjectId: CAMPAIGN_MEMBER_ID },
        },
      },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(ORGANIZATION_ID)
    expect(serialized).not.toContain(USER_ID)
    expect(serialized).not.toMatch(/"(?:observedOpportunity|recommendedOffer|subject|body|token|secret)"/iu)
  })
})

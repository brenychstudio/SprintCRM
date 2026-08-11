import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'

import {
  OPERATION_CLASSES,
  type ActionReceipt,
  type ActionRequest,
  type BridgeResult,
  type FreshnessEvaluation,
  type ProductOperationDefinition,
  type SafeValue,
} from '@brenych/product-bridge-contracts'
import type {
  IdempotencyAddress,
  IdempotencyClaim,
  IdempotencyStore,
} from '@brenych/product-bridge-core'
import type { ProductInvocationResult } from '@brenych/product-bridge-product-sdk'

import type { VerifiedSprintCrmAuthority } from './authenticated-supabase-runtime.js'
import type {
  CommitEmailDraftInput,
  CommitResearchInput,
  CrmStagedWriteDomainGateway,
  SafeBridgeProvenance,
} from './crm-staged-write-domain-gateway.js'
import {
  CRM_STAGED_WRITE_OPERATIONS,
  type CrmStagedWriteOperationId,
  type CrmStagingContext,
} from './crm-staging-context.js'

export interface ResearchStageSnapshotInput {
  readonly campaignMemberId: string
  readonly observedOpportunity: string
  readonly recommendedOffer: string
  readonly evidence: readonly { readonly url: string; readonly note: string }[]
  readonly recommendedCase: string | null
  readonly confidence: number | null
  readonly warnings: readonly string[]
}

export interface EmailStageDraftInput {
  readonly campaignMemberId: string
  readonly researchSnapshotId: string
  readonly subject: string
  readonly body: string
  readonly language: 'en' | 'es' | 'uk' | 'ru'
}

export interface SafeCrmStagingContext {
  readonly campaignMember: CrmStagingContext['campaignMember']
  readonly campaign: CrmStagingContext['campaign']
  readonly lead: CrmStagingContext['lead']
  readonly latestResearch: CrmStagingContext['latestResearch']
  readonly latestOutboundMessage: CrmStagingContext['latestOutboundMessage']
  readonly freshness: CrmStagingContext['freshness']
}

export interface SprintCrmStagingBoundary {
  getStagingContext(campaignMemberId: string): Promise<CrmStagingContext>
  evaluateFreshness(
    request: ActionRequest,
    operation: ProductOperationDefinition,
  ): Promise<FreshnessEvaluation>
  prepare(
    request: ActionRequest,
    operation: ProductOperationDefinition,
  ): Promise<ProductInvocationResult<SafeValue>>
}

interface PreparedResearchEffect {
  readonly kind: 'research'
  readonly input: ResearchStageSnapshotInput
  readonly expectedVersion: number
}

interface PreparedEmailEffect {
  readonly kind: 'email'
  readonly input: EmailStageDraftInput
  readonly expectedVersion: number
  readonly researchVersion: number
}

type PreparedEffect = PreparedResearchEffect | PreparedEmailEffect

interface ActiveClaim {
  readonly address: IdempotencyAddress
  readonly fingerprint: string
  readonly operationId: CrmStagedWriteOperationId
  readonly claimToken: string
  readonly stagedEntityId: string
  readonly campaignMemberId: string
  readonly sourceSnapshotId: `sha256:${string}`
  readonly provenance: SafeBridgeProvenance
  context?: CrmStagingContext
  prepared?: PreparedEffect
}

interface RoutedRequestState {
  readonly request: ActionRequest
  claim?: ActiveClaim
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u
const RECEIPT_MAXIMUM_BYTES = 16_384
const INTERNAL_TO_SEMANTIC_OPERATION = Object.freeze({
  'crm.research:stage_snapshot': CRM_STAGED_WRITE_OPERATIONS.RESEARCH_SNAPSHOT,
  'crm.email:stage_draft': CRM_STAGED_WRITE_OPERATIONS.EMAIL_DRAFT,
} as const)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed)
  return Object.keys(value).every((key) => allowedSet.has(key))
}

function boundedIdentifier(value: unknown, maximum: number): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || value.trim() !== value) return false
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 32 || codePoint === 127
  })
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 40
    && Number.isFinite(Date.parse(value))
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return JSON.stringify(Number.isFinite(value) ? value : null)
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error('SprintCRM logical request contains a cycle.')
    ancestors.add(value)
    const serialized = `[${value.map((entry) => canonicalize(entry, ancestors)).join(',')}]`
    ancestors.delete(value)
    return serialized
  }
  if (typeof value !== 'object') return JSON.stringify(String(value))
  if (ancestors.has(value)) throw new Error('SprintCRM logical request contains a cycle.')
  ancestors.add(value)
  const record = value as Record<string, unknown>
  const serialized = `{${Object.keys(record).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], ancestors)}`).join(',')}}`
  ancestors.delete(value)
  return serialized
}

/** Durable CRM writes use a non-reversible canonical SHA-256 semantic fingerprint. */
export function fingerprintSprintCrmLogicalRequest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalize(value, new Set()), 'utf8').digest('hex')}`
}

function operationKey(namespace: string, operationId: string): string {
  return `${namespace}:${operationId}`
}

function safeOperationId(address: IdempotencyAddress): CrmStagedWriteOperationId {
  const key = operationKey(address.namespace, address.operationId) as keyof typeof INTERNAL_TO_SEMANTIC_OPERATION
  const operationId = INTERNAL_TO_SEMANTIC_OPERATION[key]
  if (!operationId) throw new Error('SprintCRM staged write failed safely.')
  return operationId
}

function safeCampaignMemberId(request: ActionRequest): string {
  if (!isRecord(request.input) || typeof request.input.campaignMemberId !== 'string'
      || !UUID_PATTERN.test(request.input.campaignMemberId)) {
    throw new Error('SprintCRM staged write failed safely.')
  }
  return request.input.campaignMemberId
}

function toSafeStagingContext(context: CrmStagingContext): SafeCrmStagingContext {
  return {
    campaignMember: context.campaignMember,
    campaign: context.campaign,
    lead: context.lead,
    latestResearch: context.latestResearch,
    latestOutboundMessage: context.latestOutboundMessage,
    freshness: context.freshness,
  }
}

export function projectSafeCrmStagingContext(context: CrmStagingContext): SafeCrmStagingContext {
  return structuredClone(toSafeStagingContext(context))
}

function validDiagnostics(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length <= 20
    && value.every((item) => boundedIdentifier(item, 512)))
}

function validateStagedResult(
  value: unknown,
  internalOperationId: string,
  stagedEntityId: string,
): value is SafeValue {
  if (!isRecord(value) || value.entityId !== stagedEntityId || !UUID_PATTERN.test(stagedEntityId)
      || !Number.isInteger(value.version) || Number(value.version) < 1
      || !UUID_PATTERN.test(String(value.campaignMemberId))) return false
  if (internalOperationId === 'stage_snapshot') {
    return exactKeys(value, ['entityType', 'entityId', 'version', 'status', 'campaignMemberId'])
      && value.entityType === 'research_snapshot' && value.status === 'research_ready'
  }
  return exactKeys(value, [
    'entityType', 'entityId', 'version', 'status', 'campaignMemberId',
    'researchSnapshotId', 'researchVersion',
  ]) && value.entityType === 'outbound_message' && value.status === 'draft'
    && typeof value.researchSnapshotId === 'string' && UUID_PATTERN.test(value.researchSnapshotId)
    && Number.isInteger(value.researchVersion) && Number(value.researchVersion) >= 1
}

function parseSafeReceipt(
  value: unknown,
  internalOperationId: string,
  stagedEntityId?: string,
  sourceSnapshotId?: string,
): ActionReceipt {
  if (!isRecord(value) || Buffer.byteLength(JSON.stringify(value), 'utf8') > RECEIPT_MAXIMUM_BYTES
      || !exactKeys(value, [
        'schemaVersion', 'receiptId', 'requestId', 'correlationId', 'productId',
        'operationId', 'operationClass', 'status', 'timestamp', 'result',
        'sourceSnapshotId', 'resultSnapshotId', 'stagedEntityId', 'validation',
        'approval', 'provenance', 'diagnosticsSafe', 'metadataSafe',
      ])
      || !boundedIdentifier(value.schemaVersion, 40)
      || !boundedIdentifier(value.receiptId, 200)
      || !boundedIdentifier(value.requestId, 200)
      || !boundedIdentifier(value.correlationId, 200)
      || value.productId !== 'sprint-crm'
      || value.operationId !== internalOperationId
      || value.operationClass !== OPERATION_CLASSES.STAGED_WRITE
      || value.status !== 'staged'
      || !timestamp(value.timestamp)
      || typeof value.stagedEntityId !== 'string'
      || !UUID_PATTERN.test(value.stagedEntityId)
      || typeof value.sourceSnapshotId !== 'string'
      || !SHA256_PATTERN.test(value.sourceSnapshotId)
      || (stagedEntityId !== undefined && value.stagedEntityId !== stagedEntityId)
      || (sourceSnapshotId !== undefined && value.sourceSnapshotId !== sourceSnapshotId)
      || !validateStagedResult(value.result, internalOperationId, value.stagedEntityId)
      || !isRecord(value.validation) || !exactKeys(value.validation, ['state', 'diagnosticsSafe'])
      || value.validation.state !== 'pending' || !validDiagnostics(value.validation.diagnosticsSafe)
      || !isRecord(value.approval) || !exactKeys(value.approval, ['state', 'diagnosticsSafe'])
      || value.approval.state !== 'pending' || !validDiagnostics(value.approval.diagnosticsSafe)
      || value.provenance !== undefined || value.metadataSafe !== undefined
      || !validDiagnostics(value.diagnosticsSafe)) {
    throw new Error('SprintCRM staged write failed safely.')
  }
  return value as unknown as ActionReceipt
}

function canonicalizeDurableReceiptJson(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SprintCRM durable receipt is not JSON-safe.')
    return JSON.stringify(value)
  }
  if (value === undefined || typeof value === 'bigint'
      || typeof value === 'function' || typeof value === 'symbol') {
    throw new Error('SprintCRM durable receipt is not JSON-safe.')
  }
  if (ancestors.has(value)) throw new Error('SprintCRM durable receipt contains a cycle.')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value)
      if (ownKeys.some((key) => typeof key !== 'string'
          || (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key)))) {
        throw new Error('SprintCRM durable receipt is not a plain JSON array.')
      }
      const entries: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new Error('SprintCRM durable receipt contains a sparse JSON array.')
        }
        entries.push(canonicalizeDurableReceiptJson(value[index], ancestors))
      }
      return `[${entries.join(',')}]`
    }

    const prototype = Object.getPrototypeOf(value) as unknown
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('SprintCRM durable receipt is not a plain JSON object.')
    }
    const record = value as Record<string, unknown>
    const ownKeys = Reflect.ownKeys(record)
    if (ownKeys.some((key) => typeof key !== 'string'
        || !Object.prototype.propertyIsEnumerable.call(record, key))) {
      throw new Error('SprintCRM durable receipt contains non-JSON object properties.')
    }
    const entries: string[] = []
    for (const key of Object.keys(record).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key)
      if (!descriptor || !('value' in descriptor)) {
        throw new Error('SprintCRM durable receipt contains an accessor.')
      }
      if (descriptor.value === undefined) continue
      entries.push(`${JSON.stringify(key)}:${canonicalizeDurableReceiptJson(descriptor.value, ancestors)}`)
    }
    return `{${entries.join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

/** Compare an in-memory receipt with its durable JSON/JSONB representation. */
export function durableReceiptsAreJsonEquivalent(left: ActionReceipt, right: ActionReceipt): boolean {
  try {
    return canonicalizeDurableReceiptJson(left, new Set())
      === canonicalizeDurableReceiptJson(right, new Set())
  } catch {
    return false
  }
}

function receiptMatchesPreparedEffect(
  receipt: ActionReceipt,
  claim: ActiveClaim,
  prepared: PreparedEffect,
): boolean {
  if (!isRecord(receipt.result)
      || receipt.result.campaignMemberId !== claim.campaignMemberId
      || receipt.result.version !== prepared.expectedVersion) return false
  return prepared.kind === 'research'
    ? receipt.result.entityType === 'research_snapshot'
      && receipt.result.status === 'research_ready'
    : receipt.result.entityType === 'outbound_message'
      && receipt.result.status === 'draft'
      && receipt.result.researchSnapshotId === prepared.input.researchSnapshotId
      && receipt.result.researchVersion === prepared.researchVersion
}

export interface SprintCrmStagedWriteCoordinatorOptions {
  readonly gateway: CrmStagedWriteDomainGateway
  readonly authority: VerifiedSprintCrmAuthority
  readonly now?: () => string
  readonly createUuid?: () => string
}

/**
 * Product-owned coordinator joining Shared's lifecycle to the accepted CRM RPC seam.
 * Adapter invocation only prepares; commit performs the single PostgreSQL effect with
 * the exact canonical receipt supplied by Shared.
 */
export class SprintCrmStagedWriteCoordinator implements IdempotencyStore, SprintCrmStagingBoundary {
  private readonly requests = new AsyncLocalStorage<RoutedRequestState>()
  private readonly now: () => string
  private readonly createUuid: () => string

  constructor(private readonly options: SprintCrmStagedWriteCoordinatorOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.createUuid = options.createUuid ?? randomUUID
  }

  runWithRequest(request: ActionRequest, route: () => Promise<BridgeResult>): Promise<BridgeResult> {
    return this.requests.run({ request }, route)
  }

  getStagingContext(campaignMemberId: string): Promise<CrmStagingContext> {
    return this.options.gateway.getStagingContext(campaignMemberId)
  }

  async claim(address: IdempotencyAddress, fingerprint: string): Promise<IdempotencyClaim> {
    const state = this.requireState()
    const request = state.request
    const operationId = safeOperationId(address)
    const campaignMemberId = safeCampaignMemberId(request)
    const sourceSnapshotId = request.sourceSnapshot?.snapshotId
    if (request.operationClass !== OPERATION_CLASSES.STAGED_WRITE
        || request.productId !== address.productId
        || request.namespace !== address.namespace
        || request.operationId !== address.operationId
        || request.idempotencyKey !== address.key
        || !boundedIdentifier(address.key, 200)
        || !SHA256_PATTERN.test(fingerprint)
        || typeof sourceSnapshotId !== 'string' || !SHA256_PATTERN.test(sourceSnapshotId)
        || !boundedIdentifier(request.requestId, 200)
        || !boundedIdentifier(request.correlationId, 200)) {
      throw new Error('SprintCRM staged write failed safely.')
    }
    const claimToken = this.createUuid()
    const stagedEntityId = this.createUuid()
    if (!UUID_PATTERN.test(claimToken) || !UUID_PATTERN.test(stagedEntityId)) {
      throw new Error('SprintCRM staged write failed safely.')
    }
    const provenance: SafeBridgeProvenance = {
      productId: 'sprint-crm',
      operationId,
      requestId: request.requestId,
      correlationId: request.correlationId,
      actorSubject: `user:${this.options.authority.userId}`,
      organizationId: this.options.authority.organizationId,
      campaignMemberId,
      sourceSnapshotId: sourceSnapshotId as `sha256:${string}`,
      stagedEntityId,
      timestamp: this.now(),
    }
    const claim = await this.options.gateway.claim({
      operationId,
      idempotencyKey: address.key,
      semanticFingerprint: fingerprint,
      claimToken,
      provenance,
    })
    if (claim.outcome === 'REPLAY') {
      const receipt = parseSafeReceipt(claim.receipt, address.operationId, undefined, sourceSnapshotId)
      if (!isRecord(receipt.result) || receipt.result.campaignMemberId !== campaignMemberId) {
        throw new Error('SprintCRM staged write failed safely.')
      }
      return { state: 'replay', receipt }
    }
    if (claim.outcome === 'CONFLICT') return { state: 'conflict' }
    if (claim.outcome === 'IN_PROGRESS') return { state: 'pending' }
    state.claim = {
      address: { ...address },
      fingerprint,
      operationId,
      claimToken,
      stagedEntityId,
      campaignMemberId,
      sourceSnapshotId: sourceSnapshotId as `sha256:${string}`,
      provenance,
    }
    return { state: 'claimed' }
  }

  async evaluateFreshness(
    request: ActionRequest,
    operation: ProductOperationDefinition,
  ): Promise<FreshnessEvaluation> {
    try {
      const claim = this.requireClaim(request, operation)
      const context = await this.options.gateway.getStagingContext(claim.campaignMemberId)
      claim.context = context
      const current = {
        snapshotId: context.freshness.version,
        generatedAt: context.freshness.generatedAt,
        metadataSafe: {
          subjectType: context.freshness.subjectType,
          subjectId: context.freshness.subjectId,
        },
      } as const
      const supplied = request.sourceSnapshot?.snapshotId
      if (typeof supplied !== 'string' || !SHA256_PATTERN.test(supplied)) {
        return { state: 'UNKNOWN', current, reasonSafe: 'A canonical CRM staging snapshot is required.' }
      }
      return supplied === context.freshness.version
        ? { state: 'CURRENT', current }
        : { state: 'STALE', current, reasonSafe: 'The CRM staging context changed.' }
    } catch {
      return { state: 'UNKNOWN', reasonSafe: 'The CRM staging context is unavailable.' }
    }
  }

  async prepare(
    request: ActionRequest,
    operation: ProductOperationDefinition,
  ): Promise<ProductInvocationResult<SafeValue>> {
    const claim = this.requireClaim(request, operation)
    const context = claim.context
    if (!context || context.freshness.version !== claim.sourceSnapshotId) {
      throw new Error('SprintCRM staged write failed safely.')
    }
    if (claim.operationId === CRM_STAGED_WRITE_OPERATIONS.RESEARCH_SNAPSHOT) {
      const input = request.input as unknown as ResearchStageSnapshotInput
      const expectedVersion = (context.latestResearch?.version ?? 0) + 1
      claim.prepared = { kind: 'research', input, expectedVersion }
      return {
        status: 'staged',
        stagedEntityId: claim.stagedEntityId,
        result: {
          entityType: 'research_snapshot',
          entityId: claim.stagedEntityId,
          version: expectedVersion,
          status: 'research_ready',
          campaignMemberId: claim.campaignMemberId,
        },
        validation: { state: 'pending' },
        approval: { state: 'pending' },
      }
    }
    const input = request.input as unknown as EmailStageDraftInput
    if (!context.latestResearch || context.latestResearch.id !== input.researchSnapshotId) {
      throw new Error('SprintCRM staged write failed safely.')
    }
    const expectedVersion = (context.latestOutboundMessage?.version ?? 0) + 1
    claim.prepared = {
      kind: 'email',
      input,
      expectedVersion,
      researchVersion: context.latestResearch.version,
    }
    return {
      status: 'staged',
      stagedEntityId: claim.stagedEntityId,
      result: {
        entityType: 'outbound_message',
        entityId: claim.stagedEntityId,
        version: expectedVersion,
        status: 'draft',
        campaignMemberId: claim.campaignMemberId,
        researchSnapshotId: input.researchSnapshotId,
        researchVersion: context.latestResearch.version,
      },
      validation: { state: 'pending' },
      approval: { state: 'pending' },
    }
  }

  async commit(address: IdempotencyAddress, fingerprint: string, receipt: ActionReceipt): Promise<void> {
    const claim = this.requireActiveAddress(address, fingerprint)
    const prepared = claim.prepared
    if (!prepared) throw new Error('SprintCRM staged write failed safely.')
    let completed = false
    try {
      const canonicalReceipt = parseSafeReceipt(
        receipt,
        address.operationId,
        claim.stagedEntityId,
        claim.sourceSnapshotId,
      )
      if (!receiptMatchesPreparedEffect(canonicalReceipt, claim, prepared)) {
        throw new Error('SprintCRM staged write failed safely.')
      }
      const outcome = prepared.kind === 'research'
        ? await this.options.gateway.commitResearch(this.researchCommit(claim, prepared, canonicalReceipt))
        : await this.options.gateway.commitEmailDraft(this.emailCommit(claim, prepared, canonicalReceipt))
      if ((outcome.outcome !== 'COMPLETED' && outcome.outcome !== 'REPLAY')
          || !durableReceiptsAreJsonEquivalent(parseSafeReceipt(
            outcome.receipt,
            address.operationId,
            claim.stagedEntityId,
            claim.sourceSnapshotId,
          ), canonicalReceipt)) {
        throw new Error('SprintCRM staged write failed safely.')
      }
      if (outcome.outcome === 'COMPLETED'
          && (outcome.stagedEntity.id !== claim.stagedEntityId
            || outcome.stagedEntity.version !== prepared.expectedVersion
            || outcome.stagedEntity.type !== (prepared.kind === 'research' ? 'research_snapshot' : 'outbound_message')
            || outcome.stagedEntity.status !== (prepared.kind === 'research' ? 'research_ready' : 'draft'))) {
        throw new Error('SprintCRM staged write failed safely.')
      }
      completed = true
    } catch {
      if (!completed) {
        try { await this.releaseClaim(claim) } catch { /* Core receives one generic safe failure. */ }
      }
      throw new Error('SprintCRM staged write failed safely.')
    } finally {
      this.requireState().claim = undefined
    }
  }

  async release(address: IdempotencyAddress, fingerprint: string): Promise<void> {
    const claim = this.requireActiveAddress(address, fingerprint)
    try {
      const released = await this.releaseClaim(claim)
      if (!released) throw new Error('SprintCRM staged write failed safely.')
    } finally {
      this.requireState().claim = undefined
    }
  }

  private researchCommit(
    claim: ActiveClaim,
    prepared: PreparedResearchEffect,
    receipt: ActionReceipt,
  ): CommitResearchInput {
    return {
      idempotencyKey: claim.address.key,
      semanticFingerprint: claim.fingerprint,
      claimToken: claim.claimToken,
      campaignMemberId: claim.campaignMemberId,
      sourceSnapshotId: claim.sourceSnapshotId,
      stagedEntityId: claim.stagedEntityId,
      expectedVersion: prepared.expectedVersion,
      observedOpportunity: prepared.input.observedOpportunity,
      recommendedOffer: prepared.input.recommendedOffer,
      evidence: prepared.input.evidence,
      recommendedCase: prepared.input.recommendedCase,
      confidence: prepared.input.confidence,
      warnings: prepared.input.warnings,
      provenance: claim.provenance,
      receipt: receipt as unknown as CommitResearchInput['receipt'],
    }
  }

  private emailCommit(
    claim: ActiveClaim,
    prepared: PreparedEmailEffect,
    receipt: ActionReceipt,
  ): CommitEmailDraftInput {
    return {
      idempotencyKey: claim.address.key,
      semanticFingerprint: claim.fingerprint,
      claimToken: claim.claimToken,
      campaignMemberId: claim.campaignMemberId,
      sourceSnapshotId: claim.sourceSnapshotId,
      stagedEntityId: claim.stagedEntityId,
      expectedVersion: prepared.expectedVersion,
      researchSnapshotId: prepared.input.researchSnapshotId,
      subject: prepared.input.subject,
      body: prepared.input.body,
      language: prepared.input.language,
      provenance: claim.provenance,
      receipt: receipt as unknown as CommitEmailDraftInput['receipt'],
    }
  }

  private releaseClaim(claim: ActiveClaim): Promise<boolean> {
    return this.options.gateway.release({
      operationId: claim.operationId,
      idempotencyKey: claim.address.key,
      semanticFingerprint: claim.fingerprint,
      claimToken: claim.claimToken,
    })
  }

  private requireState(): RoutedRequestState {
    const state = this.requests.getStore()
    if (!state) throw new Error('SprintCRM staged write failed safely.')
    return state
  }

  private requireClaim(request: ActionRequest, operation: ProductOperationDefinition): ActiveClaim {
    const state = this.requireState()
    const claim = state.claim
    if (!claim
        || state.request.requestId !== request.requestId
        || state.request.correlationId !== request.correlationId
        || state.request.productId !== request.productId
        || state.request.subject.id !== request.subject.id
        || state.request.identity.identityId !== request.identity.identityId
        || state.request.idempotencyKey !== request.idempotencyKey
        || claim.address.namespace !== operation.namespace
        || claim.address.operationId !== operation.operationId) {
      throw new Error('SprintCRM staged write failed safely.')
    }
    return claim
  }

  private requireActiveAddress(address: IdempotencyAddress, fingerprint: string): ActiveClaim {
    const claim = this.requireState().claim
    if (!claim || claim.fingerprint !== fingerprint
        || claim.address.productId !== address.productId
        || claim.address.namespace !== address.namespace
        || claim.address.operationId !== address.operationId
        || claim.address.key !== address.key) {
      throw new Error('SprintCRM staged write failed safely.')
    }
    return claim
  }
}

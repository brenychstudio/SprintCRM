import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '../src/lib/supabase/database.types.js'
import {
  CRM_STAGED_WRITE_OPERATIONS,
  assertSemanticFingerprint,
  assertUuid,
  parseCrmStagingContext,
  type CrmStagedWriteOperationId,
  type CrmStagingContext,
} from './crm-staging-context.js'

export interface CrmStagedWriteGatewayBinding {
  readonly organizationId: string
  readonly userId: string
}

export interface SafeBridgeProvenance {
  readonly productId: 'sprint-crm'
  readonly operationId: CrmStagedWriteOperationId
  readonly requestId: string
  readonly correlationId: string
  readonly actorSubject: `user:${string}`
  readonly organizationId: string
  readonly campaignMemberId: string
  readonly sourceSnapshotId: `sha256:${string}`
  readonly stagedEntityId: string
  readonly timestamp: string
}

export type ClaimOutcome =
  | { readonly outcome: 'CLAIMED'; readonly requestLedgerId: string; readonly leaseExpiresAt: string; readonly reclaimed?: true }
  | { readonly outcome: 'REPLAY'; readonly receipt: Json }
  | { readonly outcome: 'CONFLICT' }
  | { readonly outcome: 'IN_PROGRESS' }

export type CommitOutcome =
  | { readonly outcome: 'COMPLETED'; readonly receipt: Json; readonly stagedEntity: { readonly type: string; readonly id: string; readonly version: number; readonly status: string } }
  | { readonly outcome: 'REPLAY'; readonly receipt: Json }
  | { readonly outcome: 'STALE'; readonly currentFreshness: string | null }
  | { readonly outcome: 'INVALID_STATE' }

interface ClaimInput {
  readonly operationId: CrmStagedWriteOperationId
  readonly idempotencyKey: string
  readonly semanticFingerprint: string
  readonly claimToken: string
  readonly leaseSeconds?: number
  readonly provenance: SafeBridgeProvenance
}

interface CommitBase {
  readonly idempotencyKey: string
  readonly semanticFingerprint: string
  readonly claimToken: string
  readonly campaignMemberId: string
  readonly sourceSnapshotId: `sha256:${string}`
  readonly stagedEntityId: string
  readonly expectedVersion: number
  readonly provenance: SafeBridgeProvenance
  readonly receipt: Json
}

export interface ResearchEvidenceInput {
  readonly url: string
  readonly note: string
}

export interface CommitResearchInput extends CommitBase {
  readonly observedOpportunity: string
  readonly recommendedOffer: string
  readonly evidence: readonly ResearchEvidenceInput[]
  readonly recommendedCase: string | null
  readonly confidence: number | null
  readonly warnings: readonly string[]
}

export interface CommitEmailDraftInput extends CommitBase {
  readonly researchSnapshotId: string
  readonly subject: string
  readonly body: string
  readonly language: 'en' | 'es' | 'uk' | 'ru'
}

function failSafely(): never {
  throw new Error('SprintCRM staged write failed safely.')
}

function asJson(value: unknown): Json {
  return value as Json
}

function assertBoundedIdentifier(value: string, maximum: number): void {
  if (value.length < 1 || value.length > maximum || value.trim() !== value) failSafely()
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < 32 || code === 127) failSafely()
  }
}

function parseClaim(value: Json | null): ClaimOutcome {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) failSafely()
  const outcome = value.outcome
  if (outcome === 'CONFLICT' || outcome === 'IN_PROGRESS') return { outcome }
  if (outcome === 'REPLAY' && value.receipt !== undefined) return { outcome, receipt: value.receipt as Json }
  if (outcome === 'CLAIMED'
      && typeof value.requestLedgerId === 'string'
      && typeof value.leaseExpiresAt === 'string') {
    assertUuid(value.requestLedgerId)
    return value.reclaimed === true
      ? { outcome, requestLedgerId: value.requestLedgerId, leaseExpiresAt: value.leaseExpiresAt, reclaimed: true }
      : { outcome, requestLedgerId: value.requestLedgerId, leaseExpiresAt: value.leaseExpiresAt }
  }
  failSafely()
}

function parseCommit(value: Json | null): CommitOutcome {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) failSafely()
  if (value.outcome === 'REPLAY' && value.receipt !== undefined) {
    return { outcome: 'REPLAY', receipt: value.receipt as Json }
  }
  if (value.outcome === 'STALE') {
    return { outcome: 'STALE', currentFreshness: typeof value.currentFreshness === 'string' ? value.currentFreshness : null }
  }
  if (value.outcome === 'INVALID_STATE') return { outcome: 'INVALID_STATE' }
  const stagedEntity = value.stagedEntity
  if (value.outcome === 'COMPLETED' && value.receipt !== undefined
      && typeof stagedEntity === 'object' && stagedEntity !== null && !Array.isArray(stagedEntity)
      && typeof stagedEntity.type === 'string' && typeof stagedEntity.id === 'string'
      && Number.isInteger(stagedEntity.version) && typeof stagedEntity.status === 'string') {
    assertUuid(stagedEntity.id)
    return {
      outcome: 'COMPLETED',
      receipt: value.receipt as Json,
      stagedEntity: {
        type: stagedEntity.type,
        id: stagedEntity.id,
        version: Number(stagedEntity.version),
        status: stagedEntity.status,
      },
    }
  }
  failSafely()
}

/**
 * Product-owned authenticated/RLS RPC gateway for CRM-PBG-02A.
 * It is deliberately not exported by the current adapter/runtime entrypoint.
 */
export class SupabaseCrmStagedWriteDomainGateway {
  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly binding: CrmStagedWriteGatewayBinding,
  ) {
    assertUuid(binding.organizationId)
    assertUuid(binding.userId)
  }

  async getStagingContext(campaignMemberId: string): Promise<CrmStagingContext> {
    assertUuid(campaignMemberId)
    const { data, error } = await this.client.rpc('get_product_bridge_staging_context', {
      p_expected_organization_id: this.binding.organizationId,
      p_campaign_member_id: campaignMemberId,
    })
    if (error) failSafely()
    const context = parseCrmStagingContext(data)
    if (context.organizationId !== this.binding.organizationId
        || context.actorSubject !== `user:${this.binding.userId}`
        || context.campaignMember.id !== campaignMemberId) failSafely()
    return context
  }

  async claim(input: ClaimInput): Promise<ClaimOutcome> {
    this.assertClaimInput(input)
    const { data, error } = await this.client.rpc('claim_product_bridge_write', {
      p_expected_organization_id: this.binding.organizationId,
      p_operation_id: input.operationId,
      p_idempotency_key: input.idempotencyKey,
      p_semantic_fingerprint: input.semanticFingerprint,
      p_claim_token: input.claimToken,
      p_lease_seconds: input.leaseSeconds ?? 60,
      p_provenance: asJson(input.provenance),
    })
    if (error) failSafely()
    return parseClaim(data)
  }

  async release(input: Omit<ClaimInput, 'leaseSeconds' | 'provenance'>): Promise<boolean> {
    assertUuid(input.claimToken)
    assertSemanticFingerprint(input.semanticFingerprint)
    assertBoundedIdentifier(input.idempotencyKey, 200)
    const { data, error } = await this.client.rpc('release_product_bridge_write', {
      p_expected_organization_id: this.binding.organizationId,
      p_operation_id: input.operationId,
      p_idempotency_key: input.idempotencyKey,
      p_semantic_fingerprint: input.semanticFingerprint,
      p_claim_token: input.claimToken,
    })
    if (error || typeof data !== 'boolean') failSafely()
    return data
  }

  async commitResearch(input: CommitResearchInput): Promise<CommitOutcome> {
    this.assertCommitBase(input, CRM_STAGED_WRITE_OPERATIONS.RESEARCH_SNAPSHOT)
    const { data, error } = await this.client.rpc('stage_product_bridge_research_snapshot', {
      p_expected_organization_id: this.binding.organizationId,
      p_idempotency_key: input.idempotencyKey,
      p_semantic_fingerprint: input.semanticFingerprint,
      p_claim_token: input.claimToken,
      p_campaign_member_id: input.campaignMemberId,
      p_source_snapshot_id: input.sourceSnapshotId,
      p_staged_entity_id: input.stagedEntityId,
      p_expected_version: input.expectedVersion,
      p_observed_opportunity: input.observedOpportunity,
      p_recommended_offer: input.recommendedOffer,
      p_evidence: asJson(input.evidence),
      p_recommended_case: input.recommendedCase,
      p_confidence: input.confidence,
      p_warnings: asJson(input.warnings),
      p_provenance: asJson(input.provenance),
      p_receipt: input.receipt,
    })
    if (error) failSafely()
    return parseCommit(data)
  }

  async commitEmailDraft(input: CommitEmailDraftInput): Promise<CommitOutcome> {
    this.assertCommitBase(input, CRM_STAGED_WRITE_OPERATIONS.EMAIL_DRAFT)
    assertUuid(input.researchSnapshotId)
    const { data, error } = await this.client.rpc('stage_product_bridge_email_draft', {
      p_expected_organization_id: this.binding.organizationId,
      p_idempotency_key: input.idempotencyKey,
      p_semantic_fingerprint: input.semanticFingerprint,
      p_claim_token: input.claimToken,
      p_campaign_member_id: input.campaignMemberId,
      p_source_snapshot_id: input.sourceSnapshotId,
      p_staged_entity_id: input.stagedEntityId,
      p_expected_version: input.expectedVersion,
      p_research_snapshot_id: input.researchSnapshotId,
      p_subject: input.subject,
      p_body: input.body,
      p_language: input.language,
      p_provenance: asJson(input.provenance),
      p_receipt: input.receipt,
    })
    if (error) failSafely()
    return parseCommit(data)
  }

  private assertClaimInput(input: ClaimInput): void {
    assertUuid(input.claimToken)
    assertSemanticFingerprint(input.semanticFingerprint)
    assertBoundedIdentifier(input.idempotencyKey, 200)
    if (input.leaseSeconds !== undefined && (!Number.isInteger(input.leaseSeconds)
        || input.leaseSeconds < 15 || input.leaseSeconds > 300)) failSafely()
    if (input.provenance.organizationId !== this.binding.organizationId
        || input.provenance.actorSubject !== `user:${this.binding.userId}`
        || input.provenance.operationId !== input.operationId) failSafely()
  }

  private assertCommitBase(input: CommitBase, operationId: CrmStagedWriteOperationId): void {
    assertUuid(input.claimToken)
    assertUuid(input.campaignMemberId)
    assertUuid(input.stagedEntityId)
    assertSemanticFingerprint(input.semanticFingerprint)
    assertSemanticFingerprint(input.sourceSnapshotId)
    assertBoundedIdentifier(input.idempotencyKey, 200)
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1
        || input.provenance.operationId !== operationId
        || input.provenance.organizationId !== this.binding.organizationId
        || input.provenance.actorSubject !== `user:${this.binding.userId}`
        || input.provenance.campaignMemberId !== input.campaignMemberId
        || input.provenance.sourceSnapshotId !== input.sourceSnapshotId
        || input.provenance.stagedEntityId !== input.stagedEntityId) failSafely()
  }
}

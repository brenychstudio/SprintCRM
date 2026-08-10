import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database, Json } from '../src/lib/supabase/database.types.js'
import { SPRINT_CRM_OPERATIONS } from './sprint-crm-product-adapter.js'
import {
  SupabaseCrmStagedWriteDomainGateway,
  type SafeBridgeProvenance,
} from './crm-staged-write-domain-gateway.js'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const MEMBER_ID = '33333333-3333-4333-8333-333333333333'
const RESEARCH_ID = '44444444-4444-4444-8444-444444444444'
const MESSAGE_ID = '55555555-5555-4555-8555-555555555555'
const CLAIM_TOKEN = '66666666-6666-4666-8666-666666666666'
const LEDGER_ID = '77777777-7777-4777-8777-777777777777'
const FRESHNESS = `sha256:${'a'.repeat(64)}` as const
const FINGERPRINT = `sha256:${'b'.repeat(64)}`

type RpcResult = { data: Json | null; error: null | { message: string } }

function clientWithResponses(...responses: RpcResult[]): {
  readonly client: SupabaseClient<Database>
  readonly rpc: ReturnType<typeof vi.fn>
} {
  const rpc = vi.fn()
  for (const response of responses) rpc.mockResolvedValueOnce(response)
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc }
}

function context(): Json {
  return {
    organizationId: ORG_ID,
    actorSubject: `user:${USER_ID}`,
    campaignMember: { id: MEMBER_ID, status: 'research_ready', updatedAt: '2026-08-10T09:00:00.000Z' },
    campaign: { id: '88888888-8888-4888-8888-888888888888', channel: 'email', defaultLanguage: 'es', updatedAt: '2026-08-10T08:00:00.000Z' },
    lead: { language: 'es', updatedAt: '2026-08-10T07:00:00.000Z' },
    latestResearch: { id: RESEARCH_ID, version: 2, createdAt: '2026-08-10T08:30:00.000Z' },
    latestOutboundMessage: null,
    freshness: { subjectType: 'campaign_member_staging_context', subjectId: MEMBER_ID, version: FRESHNESS, generatedAt: '2026-08-10T09:01:00.000Z' },
  }
}

function provenance(
  operationId: 'crm.research.stageSnapshot' | 'crm.email.stageDraft',
  stagedEntityId: string,
): SafeBridgeProvenance {
  return {
    productId: 'sprint-crm', operationId, requestId: 'request-1', correlationId: 'correlation-1',
    actorSubject: `user:${USER_ID}`, organizationId: ORG_ID, campaignMemberId: MEMBER_ID,
    sourceSnapshotId: FRESHNESS, stagedEntityId, timestamp: '2026-08-10T09:02:00.000Z',
  }
}

function receipt(stagedEntityId: string): Json {
  const isMessage = stagedEntityId === MESSAGE_ID
  return {
    schemaVersion: '1.0.0', receiptId: 'receipt-1', requestId: 'request-1',
    correlationId: 'correlation-1', productId: 'sprint-crm', operationId: isMessage ? 'stage_draft' : 'stage_snapshot',
    operationClass: 'STAGED_WRITE', status: 'staged', timestamp: '2026-08-10T09:02:00.000Z',
    sourceSnapshotId: FRESHNESS, stagedEntityId,
    result: {
      entityType: isMessage ? 'outbound_message' : 'research_snapshot',
      entityId: stagedEntityId,
      version: isMessage ? 1 : 3,
      status: isMessage ? 'draft' : 'research_ready',
    },
    validation: { state: 'pending' }, approval: { state: 'pending' },
  }
}

describe('CRM-PBG-02A staging context and gateway', () => {
  it('accepts only the exact PII/content-free context and binds org/member/user outside tool input', async () => {
    const fake = clientWithResponses({ data: context(), error: null })
    const gateway = new SupabaseCrmStagedWriteDomainGateway(fake.client, { organizationId: ORG_ID, userId: USER_ID })

    await expect(gateway.getStagingContext(MEMBER_ID)).resolves.toMatchObject({
      organizationId: ORG_ID, campaignMember: { id: MEMBER_ID }, freshness: { version: FRESHNESS },
    })
    expect(JSON.stringify(context())).not.toMatch(/"(?:email|phone|notes|body|subject|observedOpportunity|recommendedOffer|evidence)"\s*:/iu)
    expect(fake.rpc).toHaveBeenCalledWith('get_product_bridge_staging_context', {
      p_expected_organization_id: ORG_ID,
      p_campaign_member_id: MEMBER_ID,
    })
  })

  it('fails closed on extra fields, content, cross-org output, or RPC errors', async () => {
    const unsafe = { ...(context() as Record<string, Json | undefined>), email: 'private@example.test' }
    const wrongOrg = { ...(context() as Record<string, Json | undefined>), organizationId: '99999999-9999-4999-8999-999999999999' }
    const fake = clientWithResponses(
      { data: unsafe, error: null },
      { data: wrongOrg, error: null },
      { data: null, error: { message: 'sensitive backend detail' } },
    )
    const gateway = new SupabaseCrmStagedWriteDomainGateway(fake.client, { organizationId: ORG_ID, userId: USER_ID })

    await expect(gateway.getStagingContext(MEMBER_ID)).rejects.toThrow('unavailable')
    await expect(gateway.getStagingContext(MEMBER_ID)).rejects.toThrow('failed safely')
    await expect(gateway.getStagingContext(MEMBER_ID)).rejects.not.toThrow('sensitive backend detail')
  })

  it('maps claimed, in-progress, conflict, and exact completed replay outcomes', async () => {
    const replayReceipt = receipt(RESEARCH_ID)
    const fake = clientWithResponses(
      { data: { outcome: 'CLAIMED', requestLedgerId: LEDGER_ID, leaseExpiresAt: '2026-08-10T09:03:00.000Z' }, error: null },
      { data: { outcome: 'IN_PROGRESS' }, error: null },
      { data: { outcome: 'CONFLICT' }, error: null },
      { data: { outcome: 'REPLAY', receipt: replayReceipt }, error: null },
    )
    const gateway = new SupabaseCrmStagedWriteDomainGateway(fake.client, { organizationId: ORG_ID, userId: USER_ID })
    const input = {
      operationId: 'crm.research.stageSnapshot' as const, idempotencyKey: 'research-key-1',
      semanticFingerprint: FINGERPRINT, claimToken: CLAIM_TOKEN,
      provenance: provenance('crm.research.stageSnapshot', RESEARCH_ID),
    }

    await expect(gateway.claim(input)).resolves.toMatchObject({ outcome: 'CLAIMED', requestLedgerId: LEDGER_ID })
    await expect(gateway.claim(input)).resolves.toEqual({ outcome: 'IN_PROGRESS' })
    await expect(gateway.claim(input)).resolves.toEqual({ outcome: 'CONFLICT' })
    await expect(gateway.claim(input)).resolves.toEqual({ outcome: 'REPLAY', receipt: replayReceipt })
  })

  it('passes bounded prepared research to only the narrow transactional RPC', async () => {
    const stagedReceipt = receipt(RESEARCH_ID)
    const fake = clientWithResponses({
      data: { outcome: 'COMPLETED', receipt: stagedReceipt, stagedEntity: { type: 'research_snapshot', id: RESEARCH_ID, version: 3, status: 'research_ready' } },
      error: null,
    })
    const gateway = new SupabaseCrmStagedWriteDomainGateway(fake.client, { organizationId: ORG_ID, userId: USER_ID })
    await expect(gateway.commitResearch({
      idempotencyKey: 'research-key-1', semanticFingerprint: FINGERPRINT, claimToken: CLAIM_TOKEN,
      campaignMemberId: MEMBER_ID, sourceSnapshotId: FRESHNESS, stagedEntityId: RESEARCH_ID,
      expectedVersion: 3, observedOpportunity: 'A specific observable commercial opportunity with enough bounded detail.',
      recommendedOffer: 'A focused implementation offer with a measurable next step.',
      evidence: [{ url: 'https://example.test/source', note: 'A bounded factual note supporting the opportunity.' }],
      recommendedCase: null, confidence: 0.8, warnings: [],
      provenance: provenance('crm.research.stageSnapshot', RESEARCH_ID), receipt: stagedReceipt,
    })).resolves.toMatchObject({ outcome: 'COMPLETED', stagedEntity: { id: RESEARCH_ID, version: 3 } })
    expect(fake.rpc.mock.calls[0]?.[0]).toBe('stage_product_bridge_research_snapshot')
    expect(JSON.stringify(fake.rpc.mock.calls[0]?.[1])).not.toMatch(/service_role|openai|provider/iu)
  })

  it('passes an email-only immutable draft without approval/provider fields', async () => {
    const stagedReceipt = receipt(MESSAGE_ID)
    const fake = clientWithResponses({
      data: { outcome: 'COMPLETED', receipt: stagedReceipt, stagedEntity: { type: 'outbound_message', id: MESSAGE_ID, version: 1, status: 'draft' } },
      error: null,
    })
    const gateway = new SupabaseCrmStagedWriteDomainGateway(fake.client, { organizationId: ORG_ID, userId: USER_ID })
    await expect(gateway.commitEmailDraft({
      idempotencyKey: 'email-key-1', semanticFingerprint: FINGERPRINT, claimToken: CLAIM_TOKEN,
      campaignMemberId: MEMBER_ID, sourceSnapshotId: FRESHNESS, stagedEntityId: MESSAGE_ID,
      expectedVersion: 1, researchSnapshotId: RESEARCH_ID,
      subject: 'A focused idea for your next campaign',
      body: 'Hello, I reviewed the current public context and prepared one focused idea for your team. This is a draft for human review before any communication is approved or sent.',
      language: 'en', provenance: provenance('crm.email.stageDraft', MESSAGE_ID), receipt: stagedReceipt,
    })).resolves.toMatchObject({ outcome: 'COMPLETED', stagedEntity: { status: 'draft' } })
    const args = fake.rpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(fake.rpc.mock.calls[0]?.[0]).toBe('stage_product_bridge_email_draft')
    expect(args).toMatchObject({ p_language: 'en', p_research_snapshot_id: RESEARCH_ID })
    expect(args).not.toHaveProperty('p_channel')
    expect(args).not.toHaveProperty('p_approved_by')
    expect(args).not.toHaveProperty('p_provider')
  })

  it('reconstructs after restart and replays the durable exact receipt without a second effect call', async () => {
    const originalReceipt = receipt(MESSAGE_ID)
    const fake = clientWithResponses({ data: { outcome: 'REPLAY', receipt: originalReceipt }, error: null })
    const reconstructed = new SupabaseCrmStagedWriteDomainGateway(fake.client, { organizationId: ORG_ID, userId: USER_ID })
    const result = await reconstructed.claim({
      operationId: 'crm.email.stageDraft', idempotencyKey: 'email-key-1',
      semanticFingerprint: FINGERPRINT, claimToken: CLAIM_TOKEN,
      provenance: provenance('crm.email.stageDraft', MESSAGE_ID),
    })
    expect(result).toEqual({ outcome: 'REPLAY', receipt: originalReceipt })
    expect(fake.rpc).toHaveBeenCalledTimes(1)
  })

  it('leaves the accepted Product Adapter and MCP profile at exactly 7 READ / 0 / 0', () => {
    expect(SPRINT_CRM_OPERATIONS).toHaveLength(7)
    expect(SPRINT_CRM_OPERATIONS.every(({ operationClass }) => operationClass === 'READ')).toBe(true)
    expect(SPRINT_CRM_OPERATIONS.some(({ operationId }) => operationId.includes('stage'))).toBe(false)
  })
})

describe('CRM-PBG-02A migration contract', () => {
  it('contains the durable, transactional, RLS, replay, freshness, and no-external-effect guards', async () => {
    const sql = await readFile(path.resolve(
      'supabase/migrations/20260810000001_product_bridge_transactional_staging.sql',
    ), 'utf8')
    for (const marker of [
      'begin;', 'commit;', 'create table public.product_bridge_write_requests',
      'unique (organization_id, product_id, operation_id, idempotency_key)',
      'alter table public.product_bridge_write_requests enable row level security;',
      'revoke all on table public.product_bridge_write_requests from public, anon, authenticated;',
      "if v_request.status = 'completed' then", "'outcome', 'REPLAY'",
      "'outcome', 'CONFLICT'", "'outcome', 'IN_PROGRESS'",
      'for update of request;', 'for update of member;',
      'product_bridge_staging_context_version(', "'outcome', 'STALE'",
      "v_member.status not in ('queued', 'researching', 'research_ready')",
      "v_member.status not in ('research_ready', 'draft_ready')",
      "'bridge', 'email'", "'draft'", 'approved_by, approved_at, sent_at',
      "'product_bridge.research.staged'", "'product_bridge.email_draft.staged'",
      "'research_saved'", "'outreach_draft_saved'",
      'receipt = p_receipt', "staged_entity_type = 'research_snapshot'",
      "staged_entity_type = 'outbound_message'", "auth.role() <> 'authenticated'",
      'grant execute on function public.stage_product_bridge_email_draft',
    ]) expect(sql).toContain(marker)

    expect(sql).not.toMatch(/grant\s+execute[\s\S]*?to\s+(?:public|anon|service_role)\s*;/iu)
    expect(sql).not.toMatch(/insert\s+into\s+public\.ai_generations/iu)
    expect(sql).not.toMatch(/outreach-ai-runtime|openai|gmail/iu)
  })
})

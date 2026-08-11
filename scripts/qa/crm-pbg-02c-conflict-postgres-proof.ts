import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '../../src/lib/supabase/database.types.js'
import type { SprintCrmSemanticReadModel } from '../../product-bridge/crm-read-model.js'
import { SupabaseCrmStagedWriteDomainGateway } from '../../product-bridge/crm-staged-write-domain-gateway.js'
import {
  createSprintCrmMcpRuntime,
  type SprintCrmMcpRuntimeOptions,
} from '../../product-bridge/sprint-crm-mcp-runtime.js'
import { SPRINT_CRM_SCOPES } from '../../product-bridge/sprint-crm-product-adapter.js'

const USER_ID = 'a1000000-0000-4000-8000-000000000001'
const ORGANIZATION_ID = 'a2000000-0000-4000-8000-000000000001'
const CAMPAIGN_MEMBER_ID = 'a5000000-0000-4000-8000-000000000001'
const RESEARCH_SNAPSHOT_ID = 'a7000000-0000-4000-8000-000000000001'
const IDEMPOTENCY_KEY = 'crm-pbg-02c-postgres-conflict-proof'
const MISMATCH_CAMPAIGN_MEMBER_ID = 'b5000000-0000-4000-8000-000000000001'
const MISMATCH_RESEARCH_SNAPSHOT_ID = 'b7000000-0000-4000-8000-000000000001'
const MISMATCH_IDEMPOTENCY_KEY = 'crm-pbg-02c-postgres-receipt-mismatch-proof'

interface ClaimRpcObservation {
  readonly rpc: string
  readonly status: number
  readonly outcome?: string
  readonly code?: string
  readonly message?: string
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing disposable proof configuration: ${name}.`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function base64UrlJson(value: Readonly<Record<string, unknown>>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function testJwt(secret: string, expiresInSeconds: number = 300): string {
  const now = Math.floor(Date.now() / 1_000)
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' })
  const payload = base64UrlJson({
    aud: 'authenticated',
    exp: now + expiresInSeconds,
    iat: now - 300,
    role: 'authenticated',
    sub: USER_ID,
  })
  const unsigned = `${header}.${payload}`
  const signature = createHmac('sha256', secret).update(unsigned, 'utf8').digest('base64url')
  return `${unsigned}.${signature}`
}

const proofRpcObservations: ClaimRpcObservation[] = []

function safeObservation(rpc: string, status: number, value: unknown): ClaimRpcObservation {
  if (!isRecord(value)) return { rpc, status }
  return {
    rpc,
    status,
    ...(typeof value.outcome === 'string' ? { outcome: value.outcome } : {}),
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
    ...(typeof value.message === 'string' ? { message: value.message.slice(0, 200) } : {}),
  }
}

/**
 * SupabaseClient targets /rest/v1 while the disposable PostgREST container is
 * intentionally exposed directly. Rewriting only that fixed prefix avoids a
 * Kong container while preserving the real supabase-js/PostgREST RPC stack.
 */
function directPostgrestFetch(observations: ClaimRpcObservation[]): typeof fetch {
  return async (input, init) => {
    const originalUrl = new URL(input instanceof Request ? input.url : input.toString())
    const rpcMarker = '/rpc/'
    const rpcIndex = originalUrl.pathname.lastIndexOf(rpcMarker)
    const rpc = rpcIndex >= 0 ? originalUrl.pathname.slice(rpcIndex + rpcMarker.length) : null
    originalUrl.pathname = originalUrl.pathname.replace(/^\/rest\/v1(?=\/|$)/u, '') || '/'
    const response = input instanceof Request
      ? await fetch(new Request(originalUrl, input), init)
      : await fetch(originalUrl, init)
    if (rpc) {
      let body: unknown
      try {
        body = await response.clone().json()
      } catch {
        body = null
      }
      const observation = safeObservation(rpc, response.status, body)
      observations.push(observation)
      proofRpcObservations.push(observation)
    }
    return response
  }
}

function postgrestClient(
  postgrestUrl: string,
  jwt: string,
  observations: ClaimRpcObservation[],
): SupabaseClient<Database> {
  return createClient<Database>(postgrestUrl, 'disposable-proof-public-key', {
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
      fetch: directPostgrestFetch(observations),
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

const unusedReadModel = new Proxy({} as SprintCrmSemanticReadModel, {
  get() {
    return async () => {
      throw new Error('The disposable conflict proof must not invoke a general CRM read model.')
    }
  },
})

function proofRuntime(client: SupabaseClient<Database>, idPrefix: string) {
  let id = 0
  const authority = {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    organizationName: 'Bridge conflict proof organization',
    membershipRole: 'owner' as const,
    verifiedAt: new Date().toISOString(),
  }
  const options: SprintCrmMcpRuntimeOptions = {
    readModel: unusedReadModel,
    stagedWriteGateway: new SupabaseCrmStagedWriteDomainGateway(client, {
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
    }),
    authority,
    scopes: [SPRINT_CRM_SCOPES.OUTREACH_READ, SPRINT_CRM_SCOPES.EMAIL_STAGE],
    http: { port: 0 },
    createId: () => `${idPrefix}-${id += 1}`,
  }
  return createSprintCrmMcpRuntime(options)
}

function structuredEnvelope(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  assert.ok(isRecord(result.structuredContent), 'MCP result must contain structured content.')
  return result.structuredContent
}

function receiptFrom(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const envelope = structuredEnvelope(result)
  assert.equal(envelope.ok, true, 'Expected a successful Product Bridge result.')
  assert.ok(isRecord(envelope.receipt), 'Expected a structured Product Bridge receipt.')
  return envelope.receipt
}

function stagingContextFrom(
  result: Awaited<ReturnType<Client['callTool']>>,
  expectedResearchSnapshotId: string = RESEARCH_SNAPSHOT_ID,
): {
  readonly freshnessVersion: string
  readonly freshnessGeneratedAt: string
  readonly researchSnapshotId: string
  readonly outboundEntityId: string | null
  readonly outboundVersion: number | null
} {
  const receipt = receiptFrom(result)
  assert.ok(isRecord(receipt.result), 'Staging context receipt requires a result.')
  const context = receipt.result
  assert.ok(isRecord(context.freshness), 'Staging context requires freshness evidence.')
  assert.ok(isRecord(context.latestResearch), 'Email staging requires a research snapshot.')
  const outbound = context.latestOutboundMessage
  const freshnessVersion = context.freshness.version
  const freshnessGeneratedAt = context.freshness.generatedAt
  const researchSnapshotId = context.latestResearch.id
  assert.ok(typeof freshnessVersion === 'string')
  assert.ok(typeof freshnessGeneratedAt === 'string')
  assert.ok(typeof researchSnapshotId === 'string')
  assert.equal(researchSnapshotId, expectedResearchSnapshotId)
  return {
    freshnessVersion,
    freshnessGeneratedAt,
    researchSnapshotId,
    outboundEntityId: isRecord(outbound) && typeof outbound.id === 'string' ? outbound.id : null,
    outboundVersion: isRecord(outbound) && typeof outbound.version === 'number' ? outbound.version : null,
  }
}

async function connect(runtime: ReturnType<typeof createSprintCrmMcpRuntime>, name: string) {
  const status = await runtime.http.start()
  const client = new Client({ name, version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(status.endpoint)))
  const catalog = await client.listTools()
  assert.equal(catalog.tools.length, 10, 'Expected the accepted 8/2/0 SprintCRM tool surface.')
  return client
}

function stagingArguments(
  context: ReturnType<typeof stagingContextFrom>,
  subject: string,
  idempotencyKey: string = IDEMPOTENCY_KEY,
  campaignMemberId: string = CAMPAIGN_MEMBER_ID,
): Record<string, unknown> {
  return {
    campaignMemberId,
    researchSnapshotId: context.researchSnapshotId,
    subject,
    body: 'Hello, this disposable proof stages one bounded immutable draft for human review. It performs no approval, provider operation, or send effect.',
    language: 'en',
    _bridge: {
      idempotencyKey,
      sourceSnapshot: {
        snapshotId: context.freshnessVersion,
        generatedAt: context.freshnessGeneratedAt,
      },
    },
  }
}

async function main(): Promise<void> {
  const postgrestUrl = requiredEnvironment('SPRINTCRM_PBG02C_PROOF_POSTGREST_URL')
  const jwtSecret = requiredEnvironment('SPRINTCRM_PBG02C_PROOF_JWT_SECRET')
  const claimObservations: ClaimRpcObservation[] = []
  const invalidAuthObservations: ClaimRpcObservation[] = []
  const runtime = proofRuntime(
    postgrestClient(postgrestUrl, testJwt(jwtSecret), claimObservations),
    'crm-pbg02c-proof',
  )
  let client: Client | undefined
  let invalidAuthRuntime: ReturnType<typeof createSprintCrmMcpRuntime> | undefined
  let invalidAuthClient: Client | undefined
  try {
    client = await connect(runtime, 'sprint-crm-postgres-conflict-proof')
    const initialContext = stagingContextFrom(await client.callTool({
      name: 'crm_outreach__getStagingContext',
      arguments: { campaignMemberId: CAMPAIGN_MEMBER_ID },
    }))
    assert.equal(initialContext.outboundVersion, null, 'Fixture must begin without an outbound draft.')

    const firstArguments = stagingArguments(
      initialContext,
      'A focused immutable draft for conflict proof',
    )
    const first = await client.callTool({
      name: 'crm_email__stageDraft',
      arguments: structuredClone(firstArguments),
    })
    const firstEnvelope = structuredEnvelope(first)
    assert.equal(first.isError, false, 'A committed initial stage must return success on its first call.')
    const firstReceipt = receiptFrom(first)
    assert.equal(firstReceipt.status, 'staged')
    assert.ok(isRecord(firstReceipt.result))
    assert.equal(firstReceipt.result.status, 'draft')
    assert.equal(firstReceipt.result.version, 1)
    assert.equal(typeof firstReceipt.result.entityId, 'string')

    const replay = await client.callTool({
      name: 'crm_email__stageDraft',
      arguments: structuredClone(firstArguments),
    })
    if (replay.isError) {
      console.error(`CRM_PBG02C_REPLAY_FAILURE=${JSON.stringify({ envelope: structuredEnvelope(replay), rpc: claimObservations })}`)
    }
    assert.equal(replay.isError, false, 'Exact replay must not return a Bridge error.')
    const durableReceipt = receiptFrom(replay)
    assert.ok(isRecord(durableReceipt.result))
    assert.equal(durableReceipt.result.status, 'draft')
    assert.equal(durableReceipt.result.version, 1)
    assert.equal(typeof durableReceipt.result.entityId, 'string')
    const entityId = durableReceipt.result.entityId
    assert.deepEqual(durableReceipt, firstReceipt, 'Replay must return the exact original durable receipt.')

    const conflict = await client.callTool({
      name: 'crm_email__stageDraft',
      arguments: stagingArguments(initialContext, 'A changed semantic subject for conflict proof'),
    })
    const conflictEnvelope = structuredEnvelope(conflict)
    assert.equal(conflictEnvelope.ok, false)
    assert.ok(isRecord(conflictEnvelope.error))
    const conflictCode = conflictEnvelope.error.code
    const conflictMessage = conflictEnvelope.error.safeMessage

    const finalContext = stagingContextFrom(await client.callTool({
      name: 'crm_outreach__getStagingContext',
      arguments: { campaignMemberId: CAMPAIGN_MEMBER_ID },
    }))
    assert.equal(finalContext.outboundEntityId, entityId, 'Conflict must preserve the original staged entity.')
    assert.equal(finalContext.outboundVersion, 1, 'Conflict must not create version 2.')

    const mismatchContext = stagingContextFrom(await client.callTool({
      name: 'crm_outreach__getStagingContext',
      arguments: { campaignMemberId: MISMATCH_CAMPAIGN_MEMBER_ID },
    }), MISMATCH_RESEARCH_SNAPSHOT_ID)
    assert.equal(mismatchContext.outboundVersion, null, 'Mismatch fixture must begin without an outbound draft.')
    const mismatch = await client.callTool({
      name: 'crm_email__stageDraft',
      arguments: stagingArguments(
        mismatchContext,
        'A deliberately mismatched durable receipt control',
        MISMATCH_IDEMPOTENCY_KEY,
        MISMATCH_CAMPAIGN_MEMBER_ID,
      ),
    })
    const mismatchEnvelope = structuredEnvelope(mismatch)
    assert.equal(mismatch.isError, true, 'A meaningful durable receipt mismatch must fail closed.')
    assert.equal(mismatchEnvelope.ok, false)
    assert.ok(isRecord(mismatchEnvelope.error))
    assert.equal(mismatchEnvelope.error.code, 'INTERNAL_SAFE_FAILURE')
    assert.equal(
      mismatchEnvelope.error.safeMessage,
      'Idempotency receipt storage failed safely.',
      'A meaningful persisted receipt mismatch must not be accepted as success.',
    )
    const mismatchFinalContext = stagingContextFrom(await client.callTool({
      name: 'crm_outreach__getStagingContext',
      arguments: { campaignMemberId: MISMATCH_CAMPAIGN_MEMBER_ID },
    }), MISMATCH_RESEARCH_SNAPSHOT_ID)
    assert.equal(mismatchFinalContext.outboundVersion, 1, 'Mismatch control must exercise one real committed effect.')
    assert.equal(typeof mismatchFinalContext.outboundEntityId, 'string')

    invalidAuthRuntime = proofRuntime(
      postgrestClient(postgrestUrl, testJwt(jwtSecret, -60), invalidAuthObservations),
      'crm-pbg02c-invalid-auth-proof',
    )
    invalidAuthClient = await connect(invalidAuthRuntime, 'sprint-crm-invalid-auth-control')
    const invalidAuth = await invalidAuthClient.callTool({
      name: 'crm_email__stageDraft',
      arguments: stagingArguments(initialContext, 'An invalid-auth failure control', `${IDEMPOTENCY_KEY}-invalid-auth`),
    })
    const invalidAuthEnvelope = structuredEnvelope(invalidAuth)
    assert.equal(invalidAuthEnvelope.ok, false)
    assert.ok(isRecord(invalidAuthEnvelope.error))
    assert.equal(invalidAuthEnvelope.error.code, 'INTERNAL_SAFE_FAILURE', 'Unexpected RPC/auth failures remain fail-closed.')
    assert.ok(
      invalidAuthObservations.some((observation) => observation.status === 401 && observation.code === 'PGRST303'),
      'The correctly signed expired JWT control must be rejected by PostgREST before a product effect.',
    )

    const report = {
      stage: {
        publicOk: firstEnvelope.ok,
        durableStatus: durableReceipt.status,
        entityId,
        version: durableReceipt.result.version,
        receiptId: durableReceipt.receiptId,
      },
      replayExact: true,
      conflict: {
        code: conflictCode,
        safeMessage: conflictMessage,
        zeroEffect: finalContext.outboundEntityId === entityId && finalContext.outboundVersion === 1,
      },
      final: { entityId: finalContext.outboundEntityId, version: finalContext.outboundVersion },
      meaningfulReceiptMismatchControl: {
        code: mismatchEnvelope.error.code,
        safeMessage: mismatchEnvelope.error.safeMessage,
        committedEntityId: mismatchFinalContext.outboundEntityId,
        committedVersion: mismatchFinalContext.outboundVersion,
        failClosed: true,
      },
      claimRpc: claimObservations,
      invalidAuthControl: {
        code: invalidAuthEnvelope.error.code,
        claimRpc: invalidAuthObservations,
      },
    }
    console.log(`CRM_PBG02C_CONFLICT_PROOF=${JSON.stringify(report)}`)
    assert.equal(conflictCode, 'DUPLICATE_REQUEST', 'Durable semantic conflict must be normalized as DUPLICATE_REQUEST.')
    assert.equal(firstEnvelope.ok, true, 'Initial staged effect returned its successful receipt on the first call.')
  } finally {
    if (invalidAuthClient) await invalidAuthClient.close()
    if (invalidAuthRuntime) await invalidAuthRuntime.http.stop()
    if (client) await client.close()
    await runtime.http.stop()
  }
}

main().catch((error: unknown) => {
  const safeMessage = error instanceof Error ? error.message.slice(0, 300) : 'Unknown disposable proof failure.'
  console.error(`CRM_PBG02C_CONFLICT_PROOF_FAILURE=${JSON.stringify({ safeMessage, rpc: proofRpcObservations })}`)
  process.exitCode = 1
})

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  SPRINT_CRM_BRIDGE_ENV,
  isAllowedSupabasePublicProjectKey,
  isAllowedSupabaseUserAccessToken,
  loadSprintCrmBridgeRuntimeConfig,
  verifyExpectedOrganizationAuthority,
  type SprintCrmAuthorityProbe,
  type VerifiedSprintCrmAuthority,
} from './authenticated-supabase-runtime.js'
import type { SprintCrmSemanticReadModel } from './crm-read-model.js'
import type {
  CommitEmailDraftInput,
  CrmStagedWriteDomainGateway,
} from './crm-staged-write-domain-gateway.js'
import type { CrmStagingContext } from './crm-staging-context.js'
import {
  createSprintCrmMcpRuntime,
  createSprintCrmSafeStartupStatus,
  parseSprintCrmRuntimeScopes,
} from './sprint-crm-mcp-runtime.js'
import {
  SPRINT_CRM_DEFAULT_PILOT_SCOPES,
  SPRINT_CRM_MCP_TOOL_ALIASES,
  SPRINT_CRM_SCOPES,
  SPRINT_CRM_SEMANTIC_OPERATIONS,
} from './sprint-crm-product-adapter.js'

const NOW = '2026-08-10T10:00:00.000Z'
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const CAMPAIGN_MEMBER_ID = '44444444-4444-4444-8444-444444444444'
const CANONICAL_STATE_VERSION = `sha256:${'a'.repeat(64)}`
const AUTHORITY_FAILURE = 'SprintCRM authenticated organization authority could not be established.'
const PUBLISHABLE_PROJECT_KEY = 'sb_publishable_1234567890abcdefghij_checksum'
const syntheticJwt = (claims: Readonly<Record<string, unknown>>) => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ iss: 'supabase', ...claims })).toString('base64url'),
  'test-signature',
].join('.')
const legacyProjectKey = (role: string) => syntheticJwt({ role })
const VALID_USER_ACCESS_TOKEN = syntheticJwt({
  role: 'authenticated',
  sub: USER_ID,
  exp: 4_102_444_800,
})

const services: Array<{ stop(): Promise<void> }> = []
const clients: Client[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)))
  await Promise.all(services.splice(0).map((service) => service.stop().catch(() => undefined)))
})

function authority(): VerifiedSprintCrmAuthority {
  return {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    organizationName: 'Brenych Studio',
    membershipRole: 'owner',
    verifiedAt: NOW,
  }
}

function semanticReadModel(): SprintCrmSemanticReadModel {
  return {
    getWorkspaceContext: vi.fn(async () => ({
      workspace: {
        organizationId: ORGANIZATION_ID,
        organizationName: 'Brenych Studio',
        membershipRole: 'owner' as const,
      },
      capabilities: Object.values(SPRINT_CRM_SEMANTIC_OPERATIONS),
      generatedAt: NOW,
      canonicalStateVersion: CANONICAL_STATE_VERSION,
    })),
    searchLeads: vi.fn(async () => ({
      leads: [],
      page: { hasMore: false, nextCursor: null },
      generatedAt: NOW,
      canonicalStateVersion: CANONICAL_STATE_VERSION,
    })),
    getLead: vi.fn(async () => ({
      found: false as const,
      contactDataIncluded: false as const,
      generatedAt: NOW,
      canonicalStateVersion: CANONICAL_STATE_VERSION,
    })),
    listActionQueue: vi.fn(async () => ({
      items: [],
      dueBefore: NOW,
      hasMore: false,
      generatedAt: NOW,
      canonicalStateVersion: CANONICAL_STATE_VERSION,
    })),
    listDueFollowups: vi.fn(async () => ({
      representation: 'lead_backed_next_action' as const,
      followups: [],
      page: { hasMore: false, nextCursor: null },
      generatedAt: NOW,
      canonicalStateVersion: CANONICAL_STATE_VERSION,
    })),
    listRecentActivities: vi.fn(async () => ({
      foundLead: true,
      activities: [],
      hasMore: false,
      generatedAt: NOW,
      canonicalStateVersion: CANONICAL_STATE_VERSION,
    })),
    getPipelineSummary: vi.fn(async () => ({
      status: 'active' as const,
      filters: { niche: null, serviceInterest: null },
      countsByStage: { new: 0, contacted: 0, replied: 0, proposal: 0, won: 0, lost: 0 },
      total: 0,
      latestUpdatedAt: null,
      consistency: 'bounded_multi_query_read' as const,
      generatedAt: NOW,
      canonicalStateVersion: CANONICAL_STATE_VERSION,
    })),
  }
}

function stagedWriteGateway(): CrmStagedWriteDomainGateway {
  return {
    getStagingContext: vi.fn(async (): Promise<CrmStagingContext> => ({
      organizationId: ORGANIZATION_ID,
      actorSubject: `user:${USER_ID}`,
      campaignMember: { id: CAMPAIGN_MEMBER_ID, status: 'research_ready', updatedAt: NOW },
      campaign: { id: '55555555-5555-4555-8555-555555555555', channel: 'email', defaultLanguage: 'en', updatedAt: NOW },
      lead: { language: 'en', updatedAt: NOW },
      latestResearch: { id: '66666666-6666-4666-8666-666666666666', version: 1, createdAt: NOW },
      latestOutboundMessage: null,
      freshness: {
        subjectType: 'campaign_member_staging_context',
        subjectId: CAMPAIGN_MEMBER_ID,
        version: CANONICAL_STATE_VERSION as `sha256:${string}`,
        generatedAt: NOW,
      },
    })),
    claim: vi.fn(async () => ({ outcome: 'IN_PROGRESS' as const })),
    release: vi.fn(async () => true),
    commitResearch: vi.fn(async () => ({ outcome: 'INVALID_STATE' as const })),
    commitEmailDraft: vi.fn(async () => ({ outcome: 'INVALID_STATE' as const })),
  }
}

function validEnvironment(): Record<string, string> {
  return {
    [SPRINT_CRM_BRIDGE_ENV.supabaseUrl]: 'https://sprint-crm.supabase.co',
    [SPRINT_CRM_BRIDGE_ENV.supabaseAnonKey]: PUBLISHABLE_PROJECT_KEY,
    [SPRINT_CRM_BRIDGE_ENV.userAccessToken]: VALID_USER_ACCESS_TOKEN,
    [SPRINT_CRM_BRIDGE_ENV.expectedOrganizationId]: ORGANIZATION_ID,
  }
}

function thrownMessage(action: () => unknown): string {
  try {
    action()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('Expected action to throw.')
}

describe('SprintCRM authenticated runtime authority', () => {
  it('binds a validated user membership and organization to the expected organization', async () => {
    const getAuthenticatedUserId = vi.fn(async () => USER_ID)
    const getMembership = vi.fn(async () => ({ organizationId: ORGANIZATION_ID, role: 'owner' as const }))
    const getOrganization = vi.fn(async () => ({
      organizationId: ORGANIZATION_ID,
      organizationName: 'Brenych Studio',
    }))

    await expect(verifyExpectedOrganizationAuthority({
      getAuthenticatedUserId,
      getMembership,
      getOrganization,
    }, ORGANIZATION_ID, () => NOW)).resolves.toEqual(authority())
    expect(getMembership).toHaveBeenCalledExactlyOnceWith(USER_ID, ORGANIZATION_ID)
    expect(getOrganization).toHaveBeenCalledExactlyOnceWith(ORGANIZATION_ID)
  })

  it('fails closed with one generic error when the authenticated user is missing', async () => {
    const probe: SprintCrmAuthorityProbe = {
      getAuthenticatedUserId: async () => null,
      getMembership: async () => {
        throw new Error('membership must not be queried')
      },
      getOrganization: async () => {
        throw new Error('organization must not be queried')
      },
    }

    await expect(verifyExpectedOrganizationAuthority(probe, ORGANIZATION_ID)).rejects.toThrow(AUTHORITY_FAILURE)
  })

  it.each([
    {
      boundary: 'membership is missing',
      membership: null,
      organization: { organizationId: ORGANIZATION_ID, organizationName: 'Brenych Studio' },
    },
    {
      boundary: 'organization is missing',
      membership: { organizationId: ORGANIZATION_ID, role: 'member' as const },
      organization: null,
    },
    {
      boundary: 'membership belongs to a different organization',
      membership: { organizationId: OTHER_ORGANIZATION_ID, role: 'member' as const },
      organization: { organizationId: ORGANIZATION_ID, organizationName: 'Brenych Studio' },
    },
    {
      boundary: 'organization lookup resolves a different organization',
      membership: { organizationId: ORGANIZATION_ID, role: 'member' as const },
      organization: { organizationId: OTHER_ORGANIZATION_ID, organizationName: 'Other workspace' },
    },
  ])('fails closed when $boundary', async ({ membership, organization }) => {
    const probe: SprintCrmAuthorityProbe = {
      getAuthenticatedUserId: async () => USER_ID,
      getMembership: async () => membership,
      getOrganization: async () => organization,
    }

    await expect(verifyExpectedOrganizationAuthority(probe, ORGANIZATION_ID)).rejects.toThrow(AUTHORITY_FAILURE)
  })

  it('redacts authority-probe failures instead of propagating sensitive details', async () => {
    const sensitiveFailure = 'short-lived-user-token-sentinel: upstream detail'
    const probe: SprintCrmAuthorityProbe = {
      getAuthenticatedUserId: async () => {
        throw new Error(sensitiveFailure)
      },
      getMembership: async () => null,
      getOrganization: async () => null,
    }

    let message = ''
    try {
      await verifyExpectedOrganizationAuthority(probe, ORGANIZATION_ID)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toBe(AUTHORITY_FAILURE)
    expect(message).not.toContain(sensitiveFailure)
  })
})

describe('SprintCRM pilot configuration and scopes', () => {
  it('loads a valid minimal environment with the safe loopback pilot port default', () => {
    expect(loadSprintCrmBridgeRuntimeConfig(validEnvironment())).toEqual({
      supabaseUrl: 'https://sprint-crm.supabase.co',
      supabaseAnonKey: PUBLISHABLE_PROJECT_KEY,
      userAccessToken: VALID_USER_ACCESS_TOKEN,
      expectedOrganizationId: ORGANIZATION_ID,
      scopes: undefined,
      mcpPort: 47_841,
    })
  })

  it('rejects missing or malformed environment values without echoing provided values', () => {
    const secrets = [
      PUBLISHABLE_PROJECT_KEY,
      VALID_USER_ACCESS_TOKEN,
      'malformed-url-sentinel',
      'malformed-organization-sentinel',
      'malformed-port-sentinel',
    ]
    const malformed = [
      { ...validEnvironment(), [SPRINT_CRM_BRIDGE_ENV.supabaseUrl]: 'malformed-url-sentinel' },
      { ...validEnvironment(), [SPRINT_CRM_BRIDGE_ENV.supabaseAnonKey]: 'sb_secret_elevated-key-sentinel' },
      { ...validEnvironment(), [SPRINT_CRM_BRIDGE_ENV.expectedOrganizationId]: 'malformed-organization-sentinel' },
      { ...validEnvironment(), [SPRINT_CRM_BRIDGE_ENV.mcpPort]: 'malformed-port-sentinel' },
      { ...validEnvironment(), [SPRINT_CRM_BRIDGE_ENV.userAccessToken]: '' },
    ]

    for (const environment of malformed) {
      const message = thrownMessage(() => loadSprintCrmBridgeRuntimeConfig(environment))
      for (const secret of secrets) expect(message).not.toContain(secret)
    }
  })

  it('accepts only publishable or legacy anon project identity and rejects elevated equivalents', () => {
    expect(isAllowedSupabasePublicProjectKey(PUBLISHABLE_PROJECT_KEY)).toBe(true)
    expect(isAllowedSupabasePublicProjectKey(legacyProjectKey('anon'))).toBe(true)
    expect(isAllowedSupabasePublicProjectKey('sb_secret_1234567890abcdefghij_checksum')).toBe(false)
    expect(isAllowedSupabasePublicProjectKey(legacyProjectKey('service_role'))).toBe(false)
    expect(isAllowedSupabasePublicProjectKey(legacyProjectKey('authenticated'))).toBe(false)
    expect(isAllowedSupabasePublicProjectKey('arbitrary-nonempty-project-key')).toBe(false)
  })

  it('accepts only a non-expired authenticated user JWT in the access-token slot', () => {
    const future = 2_000_000_000
    const token = (role: string, sub: string = USER_ID, exp: number = future) => (
      syntheticJwt({ role, sub, exp })
    )
    expect(isAllowedSupabaseUserAccessToken(token('authenticated'), future - 1)).toBe(true)
    expect(isAllowedSupabaseUserAccessToken(token('authenticated'), future)).toBe(false)
    expect(isAllowedSupabaseUserAccessToken(token('anon'), future - 1)).toBe(false)
    expect(isAllowedSupabaseUserAccessToken(token('service_role'), future - 1)).toBe(false)
    expect(isAllowedSupabaseUserAccessToken(token('authenticated', 'not-a-uuid'), future - 1)).toBe(false)
    expect(isAllowedSupabaseUserAccessToken('sb_secret_1234567890abcdefghij_checksum', future - 1)).toBe(false)
    expect(isAllowedSupabaseUserAccessToken('arbitrary-nonempty-access-token', future - 1)).toBe(false)
  })

  it('rejects elevated or non-user JWTs through runtime configuration before client creation', () => {
    const elevated = [
      syntheticJwt({ role: 'service_role', sub: USER_ID, exp: 4_102_444_800 }),
      syntheticJwt({ role: 'anon', sub: USER_ID, exp: 4_102_444_800 }),
      'sb_secret_1234567890abcdefghij_checksum',
    ]
    for (const userAccessToken of elevated) {
      const message = thrownMessage(() => loadSprintCrmBridgeRuntimeConfig({
        ...validEnvironment(),
        [SPRINT_CRM_BRIDGE_ENV.userAccessToken]: userAccessToken,
      }))
      expect(message).toBe('SprintCRM Bridge requires a non-expired authenticated user access token.')
      expect(message).not.toContain(userAccessToken)
    }
  })

  it('uses bounded read defaults without granting contact data or staged writes', () => {
    const scopes = parseSprintCrmRuntimeScopes()
    expect(scopes).toEqual(SPRINT_CRM_DEFAULT_PILOT_SCOPES)
    expect(scopes).toEqual([
      'crm.context.read',
      'crm.leads.read',
      'crm.followups.read',
      'crm.activities.read',
      'crm.pipeline.read',
      'crm.outreach.read',
    ])
    expect(scopes).not.toContain(SPRINT_CRM_SCOPES.CONTACT_DATA_READ)
    expect(scopes).not.toContain(SPRINT_CRM_SCOPES.RESEARCH_STAGE)
    expect(scopes).not.toContain(SPRINT_CRM_SCOPES.EMAIL_STAGE)
  })

  it('parses, trims and deduplicates an explicit trusted scope set', () => {
    expect(parseSprintCrmRuntimeScopes(
      ' crm.leads.read,crm.contactData.read,crm.leads.read ',
    )).toEqual(['crm.leads.read', 'crm.contactData.read'])
    expect(() => parseSprintCrmRuntimeScopes('crm.leads.read,untrusted.scope'))
      .toThrow('SprintCRM Bridge runtime scopes are invalid.')
  })
})

describe('SprintCRM MCP runtime surface', () => {
  it('publishes exactly ten aliases and the derived 8/2/0 profile', () => {
    const runtime = createSprintCrmMcpRuntime({
      readModel: semanticReadModel(), stagedWriteGateway: stagedWriteGateway(), authority: authority(),
    })
    const catalog = runtime.serverFactory.getToolCatalog()
    const aliases = Object.values(SPRINT_CRM_MCP_TOOL_ALIASES).sort((left, right) => left.localeCompare(right))

    expect(catalog.map(({ definition }) => definition.name)).toEqual(aliases)
    expect(catalog).toHaveLength(10)
    expect(catalog.filter(({ operation }) => operation.operationClass === 'READ')).toHaveLength(8)
    expect(catalog.filter(({ operation }) => operation.operationClass === 'STAGED_WRITE')).toHaveLength(2)
    for (const { definition, operation } of catalog) {
      expect(definition.annotations).toEqual({
        readOnlyHint: operation.operationClass === 'READ',
        destructiveHint: false,
        idempotentHint: operation.operationClass === 'STAGED_WRITE',
        openWorldHint: false,
      })
    }
    expect(runtime.operationClassProfile).toEqual({
      operationClasses: ['READ', 'STAGED_WRITE'],
      readOperationCount: 8,
      stagedWriteOperationCount: 2,
      privilegedActionOperationCount: 0,
    })
    expect(runtime.scopes).not.toContain(SPRINT_CRM_SCOPES.CONTACT_DATA_READ)
    expect(runtime.scopes).not.toContain(SPRINT_CRM_SCOPES.RESEARCH_STAGE)
    expect(runtime.scopes).not.toContain(SPRINT_CRM_SCOPES.EMAIL_STAGE)
  })

  it('reports a safe product startup status while preserving Shared minimal /health', async () => {
    const runtime = createSprintCrmMcpRuntime({
      readModel: semanticReadModel(),
      stagedWriteGateway: stagedWriteGateway(),
      authority: authority(),
      http: { port: 0 },
      now: () => NOW,
    })
    services.push(runtime.http)
    const status = await runtime.http.start()
    const healthResponse = await fetch(status.healthEndpoint)
    expect(healthResponse.status).toBe(200)
    const health: unknown = await healthResponse.json()
    expect(health).toEqual({
      status: 'ready',
      transport: 'streamable-http',
      sessionMode: 'stateless',
      toolCount: 10,
    })

    const safeStatus = createSprintCrmSafeStartupStatus(
      status,
      runtime.operationClassProfile,
      runtime.scopes,
      true,
    )
    expect(safeStatus).toEqual({
      status: 'ready',
      productId: 'sprint-crm',
      transport: 'streamable-http',
      stateless: true,
      endpoint: status.endpoint,
      healthEndpoint: status.healthEndpoint,
      toolCount: 10,
      operationClassProfile: { READ: 8, STAGED_WRITE: 2, PRIVILEGED_ACTION: 0 },
      sourceMode: 'authenticated-rls-staging',
      contactDataGranted: false,
      stagedWriteGranted: false,
      canonicalRemoteUntouched: true,
    })

    const externallyVisibleStatus = JSON.stringify({ health, safeStatus }).toLowerCase()
    for (const sensitive of [
      USER_ID,
      ORGANIZATION_ID,
      'short-lived-user-token-sentinel',
      'anon-project-identity-sentinel',
      'useraccesstoken',
      'supabaseanonkey',
      'authorization',
    ]) expect(externallyVisibleStatus).not.toContain(sensitive.toLowerCase())
  })

  it('supports real credential-free MCP Client discovery and a fake semantic READ call', async () => {
    const readModel = semanticReadModel()
    const stagingGateway = stagedWriteGateway()
    let id = 0
    const runtime = createSprintCrmMcpRuntime({
      readModel,
      stagedWriteGateway: stagingGateway,
      authority: authority(),
      http: { port: 0 },
      now: () => NOW,
      createId: () => `crm-mcp-test-${id += 1}`,
    })
    services.push(runtime.http)
    const status = await runtime.http.start()
    const client = new Client({ name: 'sprint-crm-read-pilot-test', version: '1.0.0' })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(status.endpoint)))

    const catalog = await client.listTools()
    expect(catalog.tools.map(({ name }) => name)).toEqual(
      Object.values(SPRINT_CRM_MCP_TOOL_ALIASES).sort((left, right) => left.localeCompare(right)),
    )
    expect(catalog.tools.filter(({ annotations }) => annotations?.readOnlyHint === true)).toHaveLength(8)
    expect(catalog.tools.filter(({ annotations }) => annotations?.idempotentHint === true)).toHaveLength(2)
    expect(catalog.tools.every(({ annotations }) => annotations?.destructiveHint === false)).toBe(true)

    const result = await client.callTool({ name: 'crm_workspace__getContext', arguments: {} })
    expect(result).toMatchObject({
      isError: false,
      structuredContent: {
        ok: true,
        receipt: {
          productId: 'sprint-crm',
          operationId: 'get_context',
          operationClass: 'READ',
          status: 'completed',
          result: {
            workspace: {
              organizationId: ORGANIZATION_ID,
              organizationName: 'Brenych Studio',
              membershipRole: 'owner',
            },
            generatedAt: NOW,
            canonicalStateVersion: CANONICAL_STATE_VERSION,
          },
        },
      },
    })
    expect(JSON.stringify(result)).not.toContain(USER_ID)
    expect(JSON.stringify(result)).not.toContain(VALID_USER_ACCESS_TOKEN)
    expect(readModel.getWorkspaceContext).toHaveBeenCalledOnce()

    const deniedWrite = await client.callTool({
      name: 'crm_email__stageDraft',
      arguments: {
        campaignMemberId: CAMPAIGN_MEMBER_ID,
        researchSnapshotId: '66666666-6666-4666-8666-666666666666',
        subject: 'A focused improvement for your inquiry flow',
        body: 'Hello, I reviewed the public inquiry path and found a concrete way to reduce friction for qualified visitors. This draft remains unavailable under the safe default scope set.',
        language: 'en',
        _bridge: {
          idempotencyKey: 'crm-mcp-default-scope-denial',
          sourceSnapshot: { snapshotId: CANONICAL_STATE_VERSION, generatedAt: NOW },
        },
      },
    })
    expect(deniedWrite).toMatchObject({
      isError: true,
      structuredContent: { ok: false, error: { code: 'SCOPE_DENIED' } },
    })
    expect(stagingGateway.claim).not.toHaveBeenCalled()
  })

  it('routes one credential-free MCP staged draft through the CRM transactional boundary', async () => {
    const baseGateway = stagedWriteGateway()
    const gateway: CrmStagedWriteDomainGateway = {
      ...baseGateway,
      claim: vi.fn(async () => ({
        outcome: 'CLAIMED' as const,
        requestLedgerId: '77777777-7777-4777-8777-777777777777',
        leaseExpiresAt: NOW,
      })),
      commitEmailDraft: vi.fn(async (input: CommitEmailDraftInput) => ({
        outcome: 'COMPLETED' as const,
        receipt: input.receipt,
        stagedEntity: {
          type: 'outbound_message', id: input.stagedEntityId,
          version: input.expectedVersion, status: 'draft',
        },
      })),
    }
    let id = 0
    const runtime = createSprintCrmMcpRuntime({
      readModel: semanticReadModel(), stagedWriteGateway: gateway, authority: authority(),
      scopes: [SPRINT_CRM_SCOPES.EMAIL_STAGE],
      http: { port: 0 }, now: () => NOW,
      createId: () => `crm-mcp-staged-test-${id += 1}`,
    })
    services.push(runtime.http)
    const status = await runtime.http.start()
    const client = new Client({ name: 'sprint-crm-staged-write-test', version: '1.0.0' })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(status.endpoint)))

    const result = await client.callTool({
      name: 'crm_email__stageDraft',
      arguments: {
        campaignMemberId: CAMPAIGN_MEMBER_ID,
        researchSnapshotId: '66666666-6666-4666-8666-666666666666',
        subject: 'A focused improvement for your inquiry flow',
        body: 'Hello, I reviewed the public inquiry path and found a concrete way to reduce friction for qualified visitors. This is staged for human review and no message is sent.',
        language: 'en',
        _bridge: {
          idempotencyKey: 'crm-mcp-email-stage-key',
          sourceSnapshot: { snapshotId: CANONICAL_STATE_VERSION, generatedAt: NOW },
        },
      },
    })

    expect(result).toMatchObject({
      isError: false,
      structuredContent: {
        ok: true,
        receipt: {
          productId: 'sprint-crm', operationId: 'stage_draft',
          operationClass: 'STAGED_WRITE', status: 'staged',
          sourceSnapshotId: CANONICAL_STATE_VERSION,
          result: {
            entityType: 'outbound_message', version: 1, status: 'draft',
            campaignMemberId: CAMPAIGN_MEMBER_ID,
            researchSnapshotId: '66666666-6666-4666-8666-666666666666',
          },
          validation: { state: 'pending' }, approval: { state: 'pending' },
        },
      },
    })
    expect(gateway.claim).toHaveBeenCalledOnce()
    expect(gateway.commitEmailDraft).toHaveBeenCalledOnce()
    const serialized = JSON.stringify(result)
    expect(serialized).not.toMatch(/approved_by|approvedAt|sent_at|provider|gmail|ai_generations/iu)
  })
})

describe('SprintCRM runtime security guardrails', () => {
  it('contains only the five CRM staging RPCs and no uncontrolled mutation, AI, raw SQL or elevated key path', () => {
    const sourceFiles = [
      'product-bridge/authenticated-supabase-runtime.ts',
      'product-bridge/crm-read-model.ts',
      'product-bridge/crm-staged-write-coordinator.ts',
      'product-bridge/sprint-crm-mcp-runtime.ts',
      'product-bridge/sprint-crm-product-adapter.ts',
      'product-bridge/supabase-crm-read-gateway.ts',
      'scripts/qa/crm-pbg-01-read-pilot.ts',
    ]
    const sources = sourceFiles
      .map((file) => readFileSync(path.join(process.cwd(), file), 'utf8'))
      .join('\n')

    const forbiddenPaths = [
      /\.from\s*\([^)]*\)[\s\S]{0,500}\.(?:insert|upsert|update|delete)\s*\(/u,
      /functions\s*\.\s*invoke\s*\(/u,
      /\b(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/iu,
      /\.select\s*\(\s*['"`]\s*\*\s*['"`]\s*\)/u,
      /outreach-ai-runtime|\bopenai\b|\banthropic\b|generate(?:Text|Object)\s*\(/iu,
      /\b(?:localStorage|sessionStorage|indexedDB)\b|persistSession\s*:\s*true|detectSessionInUrl\s*:\s*true/u,
      /SUPABASE_SERVICE_ROLE|service[_ -]?role|admin[_ -]?key/iu,
    ]
    for (const forbidden of forbiddenPaths) expect(sources).not.toMatch(forbidden)

    const gatewaySource = readFileSync(
      path.join(process.cwd(), 'product-bridge/crm-staged-write-domain-gateway.ts'),
      'utf8',
    )
    const rpcNames = [...gatewaySource.matchAll(/\.rpc\('([^']+)'/gu)]
      .map((match) => match[1])
      .sort((left, right) => left.localeCompare(right))
    expect(rpcNames).toEqual([
      'claim_product_bridge_write',
      'get_product_bridge_staging_context',
      'release_product_bridge_write',
      'stage_product_bridge_email_draft',
      'stage_product_bridge_research_snapshot',
    ])
    expect(gatewaySource).not.toMatch(/\.from\s*\(|functions\s*\.\s*invoke\s*\(/u)
    expect(gatewaySource).not.toMatch(/outreach-ai-runtime|\bopenai\b|\bgmail\b|service[_ -]?role/iu)

    const pilotSource = readFileSync(
      path.join(process.cwd(), 'scripts/qa/crm-pbg-01-read-pilot.ts'),
      'utf8',
    )
    const sharedPreflightCall = pilotSource.indexOf('  verifyFrozenSharedCheckout()')
    const productBridgeDynamicImport = pilotSource.indexOf("  } = await import('../../product-bridge/index.js')")
    expect(sharedPreflightCall).toBeGreaterThan(-1)
    expect(productBridgeDynamicImport).toBeGreaterThan(sharedPreflightCall)
    expect(pilotSource.slice(0, productBridgeDynamicImport)).not.toContain(
      "from '../../product-bridge/index.js'",
    )
    expect(pilotSource).toContain("!name.toUpperCase().startsWith('SPRINTCRM_BRIDGE_')")
    expect(pilotSource).toContain('env: createGitPreflightEnvironment()')
    expect(pilotSource).not.toMatch(/JSON\.stringify\(\s*(?:config|authenticated|authority|process\.env)/u)
    expect(pilotSource).not.toMatch(/console\.(?:log|error)\([^\n]*(?:token|anonKey|userId|organizationId)/iu)
  })
})

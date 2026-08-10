import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '../src/lib/supabase/database.types.js'
import type { CrmMembershipRole } from './crm-read-model.js'

export const SPRINT_CRM_BRIDGE_ENV = Object.freeze({
  supabaseUrl: 'SPRINTCRM_BRIDGE_SUPABASE_URL',
  supabaseAnonKey: 'SPRINTCRM_BRIDGE_SUPABASE_ANON_KEY',
  userAccessToken: 'SPRINTCRM_BRIDGE_USER_ACCESS_TOKEN',
  expectedOrganizationId: 'SPRINTCRM_BRIDGE_EXPECTED_ORGANIZATION_ID',
  scopes: 'SPRINTCRM_BRIDGE_SCOPES',
  mcpPort: 'SPRINTCRM_BRIDGE_MCP_PORT',
})

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
export const SPRINT_CRM_SUPABASE_REQUEST_TIMEOUT_MS = 15_000

const boundedSupabaseFetch: typeof fetch = (input, init) => {
  const timeoutSignal = AbortSignal.timeout(SPRINT_CRM_SUPABASE_REQUEST_TIMEOUT_MS)
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal
  return fetch(input, { ...init, signal })
}

function decodedJwtPayload(value: string, maximumLength: number): Readonly<Record<string, unknown>> | null {
  if (value.length === 0 || value.length > maximumLength || value.startsWith('sb_')) return null
  const segments = value.split('.')
  if (segments.length !== 3 || segments.some((segment) => !/^[A-Za-z0-9_-]+$/u.test(segment))) return null
  try {
    const payload: unknown = JSON.parse(Buffer.from(segments[1]!, 'base64url').toString('utf8'))
    return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? payload as Readonly<Record<string, unknown>>
      : null
  } catch {
    return null
  }
}

export interface SprintCrmBridgeRuntimeConfig {
  readonly supabaseUrl: string
  readonly supabaseAnonKey: string
  readonly userAccessToken: string
  readonly expectedOrganizationId: string
  readonly scopes?: string
  readonly mcpPort: number
}

export interface VerifiedSprintCrmAuthority {
  readonly userId: string
  readonly organizationId: string
  readonly organizationName: string
  readonly membershipRole: CrmMembershipRole
  readonly verifiedAt: string
}

export interface AuthenticatedSprintCrmRuntime {
  readonly client: SupabaseClient<Database>
  readonly authority: VerifiedSprintCrmAuthority
}

export interface SprintCrmAuthorityProbe {
  getAuthenticatedUserId(): Promise<string | null>
  getMembership(
    userId: string,
    expectedOrganizationId: string,
  ): Promise<{ readonly organizationId: string; readonly role: CrmMembershipRole } | null>
  getOrganization(
    expectedOrganizationId: string,
  ): Promise<{ readonly organizationId: string; readonly organizationName: string } | null>
}

function requiredEnvironmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`Missing required runtime configuration: ${name}.`)
  return value
}

function validSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

/** Accepts only low-privilege Supabase project identities; elevated API keys fail closed. */
export function isAllowedSupabasePublicProjectKey(value: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]{20,}$/u.test(value)) return true
  return decodedJwtPayload(value, 4_096)?.role === 'anon'
}

/** Performs a fail-closed structural gate before Supabase authoritatively verifies the user token. */
export function isAllowedSupabaseUserAccessToken(
  value: string,
  nowEpochSeconds: number = Math.floor(Date.now() / 1_000),
): boolean {
  const payload = decodedJwtPayload(value, 16_384)
  return payload?.role === 'authenticated'
    && typeof payload.sub === 'string'
    && UUID_PATTERN.test(payload.sub)
    && typeof payload.exp === 'number'
    && Number.isSafeInteger(payload.exp)
    && payload.exp > nowEpochSeconds
}

export function loadSprintCrmBridgeRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SprintCrmBridgeRuntimeConfig {
  const supabaseUrl = requiredEnvironmentValue(environment, SPRINT_CRM_BRIDGE_ENV.supabaseUrl)
  const supabaseAnonKey = requiredEnvironmentValue(environment, SPRINT_CRM_BRIDGE_ENV.supabaseAnonKey)
  const userAccessToken = requiredEnvironmentValue(environment, SPRINT_CRM_BRIDGE_ENV.userAccessToken)
  const expectedOrganizationId = requiredEnvironmentValue(environment, SPRINT_CRM_BRIDGE_ENV.expectedOrganizationId)
  const configuredPort = environment[SPRINT_CRM_BRIDGE_ENV.mcpPort]?.trim()
  const mcpPort = configuredPort ? Number(configuredPort) : 47_841

  if (!validSupabaseUrl(supabaseUrl)) throw new Error('SprintCRM Bridge Supabase URL is invalid.')
  if (!isAllowedSupabasePublicProjectKey(supabaseAnonKey)) {
    throw new Error('SprintCRM Bridge requires a publishable or legacy anon project key.')
  }
  if (!isAllowedSupabaseUserAccessToken(userAccessToken)) {
    throw new Error('SprintCRM Bridge requires a non-expired authenticated user access token.')
  }
  if (!UUID_PATTERN.test(expectedOrganizationId)) throw new Error('SprintCRM Bridge expected organization ID is invalid.')
  if (!Number.isInteger(mcpPort) || mcpPort < 1 || mcpPort > 65_535) {
    throw new Error('SprintCRM Bridge MCP port is invalid.')
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    userAccessToken,
    expectedOrganizationId,
    scopes: environment[SPRINT_CRM_BRIDGE_ENV.scopes]?.trim() || undefined,
    mcpPort,
  }
}

function authorityFailure(): never {
  throw new Error('SprintCRM authenticated organization authority could not be established.')
}

/** Pure fail-closed authority check used by production and credential-free tests. */
export async function verifyExpectedOrganizationAuthority(
  probe: SprintCrmAuthorityProbe,
  expectedOrganizationId: string,
  now: () => string = () => new Date().toISOString(),
): Promise<VerifiedSprintCrmAuthority> {
  let userId: string | null
  let membership: Awaited<ReturnType<SprintCrmAuthorityProbe['getMembership']>>
  let organization: Awaited<ReturnType<SprintCrmAuthorityProbe['getOrganization']>>
  try {
    userId = await probe.getAuthenticatedUserId()
    if (!userId) authorityFailure()
    ;[membership, organization] = await Promise.all([
      probe.getMembership(userId, expectedOrganizationId),
      probe.getOrganization(expectedOrganizationId),
    ])
  } catch {
    authorityFailure()
  }
  if (
    !membership
    || !organization
    || membership.organizationId !== expectedOrganizationId
    || organization.organizationId !== expectedOrganizationId
  ) authorityFailure()

  return Object.freeze({
    userId,
    organizationId: expectedOrganizationId,
    organizationName: organization.organizationName,
    membershipRole: membership.role,
    verifiedAt: now(),
  })
}

function createSupabaseAuthorityProbe(
  client: SupabaseClient<Database>,
  accessToken: string,
): SprintCrmAuthorityProbe {
  return {
    async getAuthenticatedUserId(): Promise<string | null> {
      const { data, error } = await client.auth.getUser(accessToken)
      return error ? null : data.user?.id ?? null
    },
    async getMembership(userId, expectedOrganizationId) {
      const { data, error } = await client
        .from('memberships')
        .select('org_id,role')
        .eq('user_id', userId)
        .eq('org_id', expectedOrganizationId)
        .maybeSingle()
      return error || !data ? null : { organizationId: data.org_id, role: data.role }
    },
    async getOrganization(expectedOrganizationId) {
      const { data, error } = await client
        .from('organizations')
        .select('id,name')
        .eq('id', expectedOrganizationId)
        .maybeSingle()
      return error || !data ? null : { organizationId: data.id, organizationName: data.name }
    },
  }
}

/**
 * Creates a non-persistent user-authority client. The token remains only in process memory,
 * RLS remains active, and no refresh-token or browser storage path exists.
 */
export async function createAuthenticatedSprintCrmRuntime(
  config: SprintCrmBridgeRuntimeConfig,
  now: () => string = () => new Date().toISOString(),
): Promise<AuthenticatedSprintCrmRuntime> {
  const client = createClient<Database>(config.supabaseUrl, config.supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${config.userAccessToken}` },
      fetch: boundedSupabaseFetch,
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const authority = await verifyExpectedOrganizationAuthority(
    createSupabaseAuthorityProbe(client, config.userAccessToken),
    config.expectedOrganizationId,
    now,
  )
  return { client, authority }
}

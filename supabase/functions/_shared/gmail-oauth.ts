export const gmailAuthorizationEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth'
export const googleTokenEndpoint = 'https://oauth2.googleapis.com/token'
export const googleRevocationEndpoint = 'https://oauth2.googleapis.com/revoke'
export const googleJwksEndpoint = 'https://www.googleapis.com/oauth2/v3/certs'

export const gmailOAuthScopes = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
] as const

const requiredGrantedScopes = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send',
] as const

export const gmailPublicErrorCodes = [
  'gmail_disabled',
  'unauthorized',
  'invalid_request',
  'oauth_state_invalid',
  'oauth_state_expired',
  'oauth_state_replayed',
  'oauth_access_denied',
  'oauth_code_missing',
  'token_exchange_failed',
  'refresh_token_missing',
  'required_scope_missing',
  'identity_invalid',
  'identity_email_unverified',
  'persistence_error',
  'provider_unavailable',
  'disconnect_failed',
] as const

export type GmailPublicErrorCode = (typeof gmailPublicErrorCodes)[number]
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type OAuthMaterial = {
  state: string
  stateHash: string
  nonce: string
  codeVerifier: string
  codeChallenge: string
}

export type VerifiedGoogleIdentity = {
  subject: string
  email: string
  displayName: string | null
}

export type GoogleTokenSet = {
  accessToken: string
  refreshToken: string | null
  idToken: string
  expiresIn: number
  grantedScopes: string[]
}

export type GmailCredentialStore = {
  loadRefreshCredential: (mailboxAccountId: string) => Promise<{
    refreshToken: string
    accountStatus: string
  } | null>
  markReauthorizationRequired: (mailboxAccountId: string, safeErrorCode: string) => Promise<void>
}

export type GmailCredentialRpcClient = {
  rpc: (functionName: string, args: Record<string, unknown>) => Promise<{
    data: unknown
    error: unknown
  }>
}

export type GmailAccessTokenResult =
  | { ok: true; accessToken: string; expiresIn: number; grantedScopes: string[] }
  | { ok: false; code: 'provider_unavailable' | 'reauthorization_required' | 'credential_unavailable' }

function firstRecord(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value
  return row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : null
}

export function createGmailCredentialStore(client: GmailCredentialRpcClient): GmailCredentialStore {
  return {
    async loadRefreshCredential(mailboxAccountId) {
      const { data, error } = await client.rpc('get_gmail_refresh_credential', {
        p_mailbox_account_id: mailboxAccountId,
      })
      const row = error ? null : firstRecord(data)
      if (!row || typeof row.refresh_token !== 'string' || typeof row.account_status !== 'string') return null
      return { refreshToken: row.refresh_token, accountStatus: row.account_status }
    },
    async markReauthorizationRequired(mailboxAccountId, safeErrorCode) {
      const { error } = await client.rpc('mark_gmail_reauthorization_required', {
        p_mailbox_account_id: mailboxAccountId,
        p_safe_error_code: safeErrorCode,
      })
      if (error) throw new Error('Gmail credential state could not be updated.')
    },
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function decodeJsonSegment(value: string): Record<string, unknown> | null {
  try {
    const decoded = new TextDecoder().decode(decodeBase64Url(value))
    const parsed: unknown = JSON.parse(decoded)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return encodeBase64Url(bytes)
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return encodeBase64Url(new Uint8Array(digest))
}

export async function sha256StateHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function createOAuthMaterial(): Promise<OAuthMaterial> {
  const state = randomBase64Url(32)
  const nonce = randomBase64Url(32)
  const codeVerifier = randomBase64Url(64)
  const [stateHash, codeChallenge] = await Promise.all([
    sha256StateHash(state),
    sha256Base64Url(codeVerifier),
  ])
  return { state, stateHash, nonce, codeVerifier, codeChallenge }
}

export function buildGoogleAuthorizationUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  nonce: string
  codeChallenge: string
}): string {
  const url = new URL(gmailAuthorizationEndpoint)
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: gmailOAuthScopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  }).toString()
  return url.toString()
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

async function readJsonObject(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return readObject(await response.json())
  } catch {
    return null
  }
}

export function normalizeGrantedScopes(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return [...new Set(value.split(/\s+/).map((scope) => scope.trim()).filter(Boolean))].sort()
}

export function hasRequiredGrantedScopes(scopes: readonly string[]): boolean {
  return requiredGrantedScopes.every((scope) => scopes.includes(scope))
}

export async function exchangeAuthorizationCode(input: {
  code: string
  codeVerifier: string
  clientId: string
  clientSecret: string
  redirectUri: string
  fetchImpl?: FetchLike
}): Promise<{ ok: true; value: GoogleTokenSet } | { ok: false; code: 'token_exchange_failed' | 'provider_unavailable' }> {
  const fetchImpl = input.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(googleTokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: input.codeVerifier,
      }),
    })
  } catch {
    return { ok: false, code: 'provider_unavailable' }
  }
  const body = await readJsonObject(response)
  if (!response.ok || !body) return { ok: false, code: 'token_exchange_failed' }
  if (
    typeof body.access_token !== 'string'
    || typeof body.id_token !== 'string'
    || typeof body.expires_in !== 'number'
  ) return { ok: false, code: 'token_exchange_failed' }
  return {
    ok: true,
    value: {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
      idToken: body.id_token,
      expiresIn: body.expires_in,
      grantedScopes: normalizeGrantedScopes(body.scope),
    },
  }
}

export async function verifyGoogleIdToken(input: {
  idToken: string
  clientId: string
  expectedNonce: string
  fetchImpl?: FetchLike
  nowSeconds?: number
}): Promise<{ ok: true; identity: VerifiedGoogleIdentity } | { ok: false; code: 'identity_invalid' | 'identity_email_unverified' | 'provider_unavailable' }> {
  const segments = input.idToken.split('.')
  if (segments.length !== 3) return { ok: false, code: 'identity_invalid' }
  const header = decodeJsonSegment(segments[0])
  const claims = decodeJsonSegment(segments[1])
  if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string') {
    return { ok: false, code: 'identity_invalid' }
  }

  const fetchImpl = input.fetchImpl ?? fetch
  let jwksResponse: Response
  try {
    jwksResponse = await fetchImpl(googleJwksEndpoint)
  } catch {
    return { ok: false, code: 'provider_unavailable' }
  }
  const jwks = await readJsonObject(jwksResponse)
  if (!jwksResponse.ok || !jwks || !Array.isArray(jwks.keys)) {
    return { ok: false, code: 'provider_unavailable' }
  }
  const jwk = jwks.keys.find((candidate) => {
    const key = readObject(candidate)
    if (!key) return false
    return key.kid === header.kid && key.kty === 'RSA' && (key.use === undefined || key.use === 'sig')
  })
  if (!jwk) return { ok: false, code: 'identity_invalid' }

  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk as JsonWebKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const signed = new TextEncoder().encode(`${segments[0]}.${segments[1]}`)
    const signatureValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, decodeBase64Url(segments[2]), signed,
    )
    if (!signatureValid) return { ok: false, code: 'identity_invalid' }
  } catch {
    return { ok: false, code: 'identity_invalid' }
  }

  const issuerValid = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com'
  const audienceValid = claims.aud === input.clientId
    || (Array.isArray(claims.aud) && claims.aud.includes(input.clientId) && claims.azp === input.clientId)
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const expiryValid = typeof claims.exp === 'number' && claims.exp > nowSeconds
  const nonceValid = claims.nonce === input.expectedNonce
  const subjectValid = typeof claims.sub === 'string' && claims.sub.length > 0 && claims.sub.length <= 255
  const emailValid = typeof claims.email === 'string' && claims.email.includes('@')
  if (!issuerValid || !audienceValid || !expiryValid || !nonceValid || !subjectValid || !emailValid) {
    return { ok: false, code: 'identity_invalid' }
  }
  if (claims.email_verified !== true) return { ok: false, code: 'identity_email_unverified' }
  return {
    ok: true,
    identity: {
      subject: claims.sub as string,
      email: claims.email as string,
      displayName: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : null,
    },
  }
}

export async function getValidGmailAccessToken(input: {
  mailboxAccountId: string
  clientId: string
  clientSecret: string
  credentialStore: GmailCredentialStore
  fetchImpl?: FetchLike
}): Promise<GmailAccessTokenResult> {
  const credential = await input.credentialStore.loadRefreshCredential(input.mailboxAccountId)
  if (!credential || credential.accountStatus === 'disconnected' || credential.accountStatus === 'revoked') {
    return { ok: false, code: 'credential_unavailable' }
  }
  const fetchImpl = input.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(googleTokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        refresh_token: credential.refreshToken,
        grant_type: 'refresh_token',
      }),
    })
  } catch {
    return { ok: false, code: 'provider_unavailable' }
  }
  const body = await readJsonObject(response)
  if (!response.ok) {
    if (body?.error === 'invalid_grant') {
      await input.credentialStore.markReauthorizationRequired(input.mailboxAccountId, 'refresh_token_revoked')
      return { ok: false, code: 'reauthorization_required' }
    }
    return { ok: false, code: 'provider_unavailable' }
  }
  if (!body || typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
    return { ok: false, code: 'provider_unavailable' }
  }
  return {
    ok: true,
    accessToken: body.access_token,
    expiresIn: body.expires_in,
    grantedScopes: normalizeGrantedScopes(body.scope),
  }
}

export async function revokeGoogleToken(
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<'confirmed' | 'already_invalid' | 'unconfirmed'> {
  let response: Response
  try {
    response = await fetchImpl(`${googleRevocationEndpoint}?token=${encodeURIComponent(refreshToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  } catch {
    return 'unconfirmed'
  }
  if (response.ok) return 'confirmed'
  if (response.status === 400) return 'already_invalid'
  return 'unconfirmed'
}

export function buildSafeAppRedirect(
  appBaseUrl: string,
  result: { connected: true } | { connected: false; code: GmailPublicErrorCode },
): string {
  const base = new URL(appBaseUrl)
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Invalid APP_BASE_URL')
  const target = new URL('/settings', base.origin)
  if (result.connected) target.searchParams.set('gmail', 'connected')
  else target.searchParams.set('gmail_error', result.code)
  return target.toString()
}

export function isGmailEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function isAllowedAppOrigin(origin: string | null, appBaseUrl: string): boolean {
  if (!origin) return false
  try {
    return new URL(origin).origin === new URL(appBaseUrl).origin
  } catch {
    return false
  }
}

export function gmailCorsHeaders(origin: string | null, appBaseUrl: string): HeadersInit {
  if (!origin || !isAllowedAppOrigin(origin, appBaseUrl)) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

export function isGmailPublicErrorCode(value: unknown): value is GmailPublicErrorCode {
  return typeof value === 'string' && gmailPublicErrorCodes.includes(value as GmailPublicErrorCode)
}

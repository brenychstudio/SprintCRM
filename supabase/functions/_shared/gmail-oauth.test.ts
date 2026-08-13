import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  buildGoogleAuthorizationUrl,
  buildSafeAppRedirect,
  classifyGoogleGrantedScope,
  createGmailCredentialStore,
  createOAuthMaterial,
  exchangeAuthorizationCode,
  getValidGmailAccessToken,
  gmailOAuthScopes,
  googleJwksEndpoint,
  googleRevocationEndpoint,
  googleTokenEndpoint,
  hasRequiredGmailCapability,
  revokeGoogleToken,
  sha256Base64Url,
  sha256StateHash,
  verifyGoogleIdToken,
  type FetchLike,
  type GmailCredentialStore,
} from './gmail-oauth'

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

let privateKey: CryptoKey
let publicJwk: JsonWebKey

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair
  privateKey = pair.privateKey
  publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'test-key', use: 'sig', alg: 'RS256' }
})

async function signedIdToken(overrides: Record<string, unknown> = {}): Promise<string> {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' }))
  const payload = base64Url(JSON.stringify({
    iss: 'https://accounts.google.com',
    aud: 'client-id',
    exp: 2_000_000_000,
    nonce: 'expected-nonce',
    sub: 'stable-google-subject',
    email: 'mutable@example.test',
    email_verified: true,
    name: 'Mailbox Owner',
    ...overrides,
  }))
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${header}.${payload}`),
  )
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`
}

function jwksFetch(): FetchLike {
  return vi.fn(async (input) => {
    expect(String(input)).toBe(googleJwksEndpoint)
    return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
  }) as FetchLike
}

describe('Gmail OAuth material and authorization contract', () => {
  it('creates strong opaque state, nonce, verifier, state hash, and S256 challenge', async () => {
    const material = await createOAuthMaterial()
    expect(material.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(material.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(material.codeVerifier).toMatch(/^[A-Za-z0-9_-]{86}$/)
    expect(material.stateHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(material.stateHash).not.toContain(material.state)
    expect(material.codeChallenge).toBe(await sha256Base64Url(material.codeVerifier))
    expect(material.stateHash).toBe(await sha256StateHash(material.state))
  })

  it('builds an exact offline consent URL with only the approved scopes and PKCE S256', () => {
    const url = new URL(buildGoogleAuthorizationUrl({
      clientId: 'client-id',
      redirectUri: 'https://functions.example.test/gmail-oauth-callback',
      state: 'state-value',
      nonce: 'nonce-value',
      codeChallenge: 'challenge-value',
    }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([...gmailOAuthScopes])
    expect(url.searchParams.get('redirect_uri')).toBe('https://functions.example.test/gmail-oauth-callback')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('nonce')).toBe('nonce-value')
    expect(url.toString()).not.toMatch(/gmail\.(?:readonly|metadata|modify|compose)|mail\.google\.com/)
  })

  it.each([
    ['OIDC aliases', ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.send']],
    ['canonical userinfo scopes', [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/gmail.send',
    ]],
    ['gmail.send with identity proven independently by the signed ID token', [
      'https://www.googleapis.com/auth/gmail.send',
    ]],
  ])('accepts the %s granted-scope representation', (_label, scopes) => {
    expect(hasRequiredGmailCapability(scopes)).toBe(true)
  })

  it.each([
    ['missing gmail.send', ['openid', 'email', 'profile']],
    ['gmail.readonly', ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly']],
    ['gmail.metadata', ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.metadata']],
    ['gmail.modify', ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.modify']],
    ['gmail.compose', ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.compose']],
    ['gmail.labels', ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.labels']],
    ['gmail.settings', ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.settings.basic']],
    ['full mailbox', ['https://www.googleapis.com/auth/gmail.send', 'https://mail.google.com/']],
    ['full mailbox without trailing slash', ['https://www.googleapis.com/auth/gmail.send', 'https://mail.google.com']],
  ])('rejects %s authority', (_label, scopes) => {
    expect(hasRequiredGmailCapability(scopes)).toBe(false)
  })

  it('classifies identity aliases separately from Gmail capabilities', () => {
    expect(classifyGoogleGrantedScope('email')).toBe('identity')
    expect(classifyGoogleGrantedScope('https://www.googleapis.com/auth/userinfo.email')).toBe('identity')
    expect(classifyGoogleGrantedScope('https://www.googleapis.com/auth/gmail.send')).toBe('gmail_send')
    expect(classifyGoogleGrantedScope('https://www.googleapis.com/auth/gmail.modify')).toBe('forbidden_gmail')
  })

  it('uses only fixed Settings success and allowlisted error redirects', () => {
    expect(buildSafeAppRedirect('https://crm.example.test/app', { connected: true }))
      .toBe('https://crm.example.test/settings?gmail=connected')
    expect(buildSafeAppRedirect('https://crm.example.test', { connected: false, code: 'oauth_access_denied' }))
      .toBe('https://crm.example.test/settings?gmail_error=oauth_access_denied')
    expect(() => buildSafeAppRedirect('javascript:alert(1)', { connected: true })).toThrow()
  })
})

describe('Google code exchange and identity verification', () => {
  it('exchanges the code once with exact redirect URI and PKCE verifier', async () => {
    const fetchImpl = vi.fn(async (_input, init) => {
      const form = new URLSearchParams(String(init?.body))
      expect(form.get('grant_type')).toBe('authorization_code')
      expect(form.get('code_verifier')).toBe('private-verifier')
      expect(form.get('redirect_uri')).toBe('https://functions.example.test/callback')
      return new Response(JSON.stringify({
        access_token: 'memory-only-access', refresh_token: 'vault-refresh', id_token: 'signed-id-token',
        expires_in: 3600, scope: 'email openid https://www.googleapis.com/auth/gmail.send profile',
      }), { status: 200 })
    }) as FetchLike
    const result = await exchangeAuthorizationCode({
      code: 'one-time-code', codeVerifier: 'private-verifier', clientId: 'client-id',
      clientSecret: 'server-secret', redirectUri: 'https://functions.example.test/callback', fetchImpl,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(googleTokenEndpoint)
    expect(result).toMatchObject({ ok: true, value: { refreshToken: 'vault-refresh' } })
  })

  it('maps provider bodies and transport failures to safe exchange codes', async () => {
    const rejected = await exchangeAuthorizationCode({
      code: 'code', codeVerifier: 'verifier', clientId: 'client', clientSecret: 'secret', redirectUri: 'https://callback.test',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'raw secret detail' }), { status: 400 })) as FetchLike,
    })
    expect(rejected).toEqual({ ok: false, code: 'token_exchange_failed' })
    const unavailable = await exchangeAuthorizationCode({
      code: 'code', codeVerifier: 'verifier', clientId: 'client', clientSecret: 'secret', redirectUri: 'https://callback.test',
      fetchImpl: vi.fn(async () => { throw new Error('network detail') }) as FetchLike,
    })
    expect(unavailable).toEqual({ ok: false, code: 'provider_unavailable' })
  })

  it('keeps a missing refresh token explicit for first-connection enforcement', async () => {
    const result = await exchangeAuthorizationCode({
      code: 'code', codeVerifier: 'verifier', clientId: 'client', clientSecret: 'secret', redirectUri: 'https://callback.test',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ access_token: 'access', id_token: 'id', expires_in: 3600, scope: 'openid email' }), { status: 200 })) as FetchLike,
    })
    expect(result).toMatchObject({ ok: true, value: { refreshToken: null } })
  })

  it('accepts a signed Google identity and returns sub as the stable identity', async () => {
    const result = await verifyGoogleIdToken({
      idToken: await signedIdToken(), clientId: 'client-id', expectedNonce: 'expected-nonce',
      nowSeconds: 1_900_000_000, fetchImpl: jwksFetch(),
    })
    expect(result).toEqual({
      ok: true,
      identity: { subject: 'stable-google-subject', email: 'mutable@example.test', displayName: 'Mailbox Owner' },
    })
    expect(result.ok && result.identity.subject).not.toBe(result.ok && result.identity.email)
  })

  it('accepts gmail.send alone when the signed ID token independently proves identity', async () => {
    expect(hasRequiredGmailCapability(['https://www.googleapis.com/auth/gmail.send'])).toBe(true)
    const identity = await verifyGoogleIdToken({
      idToken: await signedIdToken(), clientId: 'client-id', expectedNonce: 'expected-nonce',
      nowSeconds: 1_900_000_000, fetchImpl: jwksFetch(),
    })
    expect(identity).toMatchObject({
      ok: true,
      identity: { subject: 'stable-google-subject', email: 'mutable@example.test' },
    })
  })

  it.each([
    ['issuer', { iss: 'https://attacker.example.test' }],
    ['audience', { aud: 'other-client' }],
    ['expiry', { exp: 1_800_000_000 }],
    ['nonce', { nonce: 'other-nonce' }],
    ['subject', { sub: '' }],
  ])('rejects an invalid %s claim', async (_label, overrides) => {
    const result = await verifyGoogleIdToken({
      idToken: await signedIdToken(overrides), clientId: 'client-id', expectedNonce: 'expected-nonce',
      nowSeconds: 1_900_000_000, fetchImpl: jwksFetch(),
    })
    expect(result).toEqual({ ok: false, code: 'identity_invalid' })
  })

  it('rejects an unverified provider email independently from other identity claims', async () => {
    const result = await verifyGoogleIdToken({
      idToken: await signedIdToken({ email_verified: false }), clientId: 'client-id', expectedNonce: 'expected-nonce',
      nowSeconds: 1_900_000_000, fetchImpl: jwksFetch(),
    })
    expect(result).toEqual({ ok: false, code: 'identity_email_unverified' })
  })

  it('rejects a token whose signature was changed', async () => {
    const token = await signedIdToken()
    const changed = `${token.slice(0, -2)}aa`
    const result = await verifyGoogleIdToken({
      idToken: changed, clientId: 'client-id', expectedNonce: 'expected-nonce',
      nowSeconds: 1_900_000_000, fetchImpl: jwksFetch(),
    })
    expect(result).toEqual({ ok: false, code: 'identity_invalid' })
  })
})

describe('refresh and disconnect helpers', () => {
  function store(refreshToken = 'vault-only-refresh'): GmailCredentialStore & { mark: ReturnType<typeof vi.fn> } {
    const mark = vi.fn(async () => undefined)
    return {
      mark,
      loadRefreshCredential: vi.fn(async () => ({ refreshToken, accountStatus: 'connected' })),
      markReauthorizationRequired: mark,
    }
  }

  it('returns a refreshed access token only in memory and does not persist it', async () => {
    const credentialStore = store()
    const fetchImpl = vi.fn(async (_input, init) => {
      expect(String(init?.body)).toContain('refresh_token=vault-only-refresh')
      return new Response(JSON.stringify({ access_token: 'short-lived-access', expires_in: 3600, scope: 'openid email' }), { status: 200 })
    }) as FetchLike
    const result = await getValidGmailAccessToken({
      mailboxAccountId: 'account-id', clientId: 'client-id', clientSecret: 'server-secret', credentialStore, fetchImpl,
    })
    expect(result).toEqual({ ok: true, accessToken: 'short-lived-access', expiresIn: 3600, grantedScopes: ['email', 'openid'] })
    expect(credentialStore.mark).not.toHaveBeenCalled()
  })

  it('loads and marks credentials only through the narrow server RPCs', async () => {
    const rpc = vi.fn(async (functionName: string) => functionName === 'get_gmail_refresh_credential'
      ? { data: [{ refresh_token: 'vault-secret', account_status: 'connected' }], error: null }
      : { data: null, error: null })
    const credentialStore = createGmailCredentialStore({ rpc })
    await expect(credentialStore.loadRefreshCredential('account-id')).resolves.toEqual({
      refreshToken: 'vault-secret', accountStatus: 'connected',
    })
    await credentialStore.markReauthorizationRequired('account-id', 'refresh_token_revoked')
    expect(rpc).toHaveBeenNthCalledWith(1, 'get_gmail_refresh_credential', { p_mailbox_account_id: 'account-id' })
    expect(rpc).toHaveBeenNthCalledWith(2, 'mark_gmail_reauthorization_required', {
      p_mailbox_account_id: 'account-id', p_safe_error_code: 'refresh_token_revoked',
    })
  })

  it('marks reauthorization required on revoked refresh-token evidence', async () => {
    const credentialStore = store()
    const result = await getValidGmailAccessToken({
      mailboxAccountId: 'account-id', clientId: 'client-id', clientSecret: 'server-secret', credentialStore,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as FetchLike,
    })
    expect(result).toEqual({ ok: false, code: 'reauthorization_required' })
    expect(credentialStore.mark).toHaveBeenCalledWith('account-id', 'refresh_token_revoked')
  })

  it('distinguishes confirmed, already-invalid, and unconfirmed revocation', async () => {
    const confirmed = vi.fn(async () => new Response(null, { status: 200 })) as FetchLike
    const invalid = vi.fn(async () => new Response(null, { status: 400 })) as FetchLike
    const unavailable = vi.fn(async () => { throw new Error('offline') }) as FetchLike
    await expect(revokeGoogleToken('refresh', confirmed)).resolves.toBe('confirmed')
    await expect(revokeGoogleToken('refresh', invalid)).resolves.toBe('already_invalid')
    await expect(revokeGoogleToken('refresh', unavailable)).resolves.toBe('unconfirmed')
    expect(String(confirmed.mock.calls[0]?.[0])).toBe(`${googleRevocationEndpoint}?token=refresh`)
  })

  it('does not log provider tokens', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await revokeGoogleToken('never-log-this', vi.fn(async () => new Response(null, { status: 200 })) as FetchLike)
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
})

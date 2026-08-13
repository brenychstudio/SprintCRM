import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve('supabase/migrations/20260812000001_gmail_account_communication_foundation.sql'), 'utf8')
const start = readFileSync(resolve('supabase/functions/gmail-oauth-start/index.ts'), 'utf8')
const callback = readFileSync(resolve('supabase/functions/gmail-oauth-callback/index.ts'), 'utf8')
const disconnect = readFileSync(resolve('supabase/functions/gmail-oauth-disconnect/index.ts'), 'utf8')
const shared = readFileSync(resolve('supabase/functions/_shared/gmail-oauth.ts'), 'utf8')
const bridgeMigration = readFileSync(resolve('supabase/migrations/20260810000001_product_bridge_transactional_staging.sql'), 'utf8')
const functionConfig = readFileSync(resolve('supabase/config.toml'), 'utf8')
const environmentExample = readFileSync(resolve('.env.example'), 'utf8')

describe('Gmail connection authority contract', () => {
  it('keeps the approved scope set exact and excludes inbox or broad mail authority', () => {
    const scopeBlock = shared.slice(shared.indexOf('export const gmailOAuthScopes'), shared.indexOf('] as const') + 10)
    expect(scopeBlock).toContain("'openid'")
    expect(scopeBlock).toContain("'email'")
    expect(scopeBlock).toContain("'profile'")
    expect(scopeBlock).toContain("'https://www.googleapis.com/auth/gmail.send'")
    expect(scopeBlock).not.toMatch(/mail\.google\.com|gmail\.(?:readonly|metadata|modify|compose|settings)/)
  })

  it('pins every Gmail Edge client to the accepted Supabase JS version', () => {
    for (const source of [start, callback, disconnect]) {
      expect(source).toContain("npm:@supabase/supabase-js@2.97.0")
      expect(source).not.toMatch(/npm:@supabase\/supabase-js@2['"]/)
    }
  })

  it('stores state only as SHA-256, retains PKCE privately, and makes callback claim one-time', () => {
    expect(start).toContain('p_state_hash: material.stateHash')
    expect(start).not.toContain('p_state: material.state')
    expect(start).toContain('p_pkce_code_verifier: material.codeVerifier')
    expect(callback).toContain("claim.claim_outcome === 'EXPIRED'")
    expect(callback).toContain("claim.claim_outcome !== 'CLAIMED'")
    expect(migration).toMatch(/where request\.state_hash = p_state_hash\r?\n\s+for update/)
    expect(migration).toContain("set status = 'claimed', consumed_at = now()")
  })

  it('validates signed ID-token identity and persists Google sub instead of email as identity', () => {
    for (const marker of ['issuerValid', 'audienceValid', 'expiryValid', 'nonceValid', 'email_verified', 'signatureValid']) {
      expect(shared).toContain(marker)
    }
    expect(callback).toContain('p_provider_account_subject: identityResult.identity.subject')
    expect(callback).toContain('p_email_address: identityResult.identity.email')
  })

  it('separates Gmail capability proof from signed identity proof before persistence', () => {
    const capabilityProof = callback.indexOf('hasRequiredGmailCapability(tokenResult.value.grantedScopes)')
    const identityProof = callback.indexOf('verifyGoogleIdToken({')
    const persistence = callback.indexOf("service.rpc('complete_gmail_account_connection'")
    expect(capabilityProof).toBeGreaterThan(-1)
    expect(identityProof).toBeGreaterThan(capabilityProof)
    expect(persistence).toBeGreaterThan(identityProof)
  })

  it('fails callback denial, missing code, missing refresh token, and missing scope with stable codes', () => {
    expect(callback).toContain("providerError === 'access_denied' ? 'oauth_access_denied'")
    expect(callback).toContain("return fail('oauth_code_missing')")
    expect(callback).toContain("return fail('refresh_token_missing')")
    expect(callback).toContain("return fail('required_scope_missing')")
    expect(callback).not.toContain('error_description')
  })

  it('never exposes provider credentials in Edge responses or logs', () => {
    const edgeSources = `${start}\n${callback}\n${disconnect}`
    expect(edgeSources).not.toMatch(/console\.(?:log|info|warn|error)/)
    expect(edgeSources).not.toMatch(/JSON\.stringify\([^)]*(?:refreshToken|accessToken|idToken|clientSecret)/)
    expect(start).not.toContain('material.codeVerifier,\n    expires_at')
    expect(disconnect).not.toContain('refresh_token: refreshToken')
  })

  it('has no send, draft, inbox, or synchronization implementation', () => {
    const gmailSources = `${migration}\n${start}\n${callback}\n${disconnect}\n${shared}`
    expect(gmailSources).not.toMatch(/users[.]messages[.](?:send|insert|import)|users[.]drafts|users[.]watch/)
    expect(gmailSources).not.toMatch(/gmail\.googleapis\.com\/gmail\/v1/)
    expect(gmailSources).not.toMatch(/create\s+(?:or\s+replace\s+)?function[^;]*(?:send_gmail|gmail_send)/i)
  })

  it('leaves the accepted Product Bridge migration and privileged authority surface unchanged', () => {
    expect(bridgeMigration).not.toMatch(/gmail|mailbox_accounts|email_send_requests/i)
    expect(migration).not.toMatch(/product_bridge_operation|privileged_action/i)
  })

  it('keeps both connection switches default-off and disables JWT verification only for callback transport', () => {
    expect(environmentExample).toContain('VITE_GMAIL_CONNECTION_ENABLED=false')
    expect(environmentExample).toContain('GMAIL_CONNECTION_ENABLED=false')
    expect(environmentExample).toContain('VITE_CONTROLLED_SEND_ENABLED=false')
    expect(functionConfig).toMatch(/\[functions\.gmail-oauth-start\]\s*verify_jwt = true/)
    expect(functionConfig).toMatch(/\[functions\.gmail-oauth-callback\]\s*verify_jwt = false/)
    expect(functionConfig).toMatch(/\[functions\.gmail-oauth-disconnect\]\s*verify_jwt = true/)
  })
})

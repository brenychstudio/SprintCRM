import { createClient } from 'npm:@supabase/supabase-js@2.97.0'
import {
  buildSafeAppRedirect,
  exchangeAuthorizationCode,
  hasRequiredGrantedScopes,
  isGmailEnabled,
  sha256StateHash,
  verifyGoogleIdToken,
  type GmailPublicErrorCode,
} from '../_shared/gmail-oauth.ts'

type ClaimedRequest = {
  claim_outcome: string
  request_id: string | null
  organization_id: string | null
  initiating_user_id: string | null
  nonce: string | null
  pkce_code_verifier: string | null
  requested_scopes: string[] | null
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value
  return row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : null
}

function claimedRequest(value: unknown): ClaimedRequest | null {
  const row = firstRow(value)
  if (!row || typeof row.claim_outcome !== 'string') return null
  return row as ClaimedRequest
}

Deno.serve(async (request) => {
  const appBaseUrl = Deno.env.get('APP_BASE_URL')
  if (!appBaseUrl) return new Response('Gmail connection is unavailable.', { status: 503 })
  const redirect = (result: { connected: true } | { connected: false; code: GmailPublicErrorCode }) =>
    Response.redirect(buildSafeAppRedirect(appBaseUrl, result), 303)
  if (request.method !== 'GET') return redirect({ connected: false, code: 'invalid_request' })
  if (!isGmailEnabled(Deno.env.get('GMAIL_CONNECTION_ENABLED'))) {
    return redirect({ connected: false, code: 'gmail_disabled' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')
  const redirectUri = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI')
  if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !redirectUri) {
    return redirect({ connected: false, code: 'provider_unavailable' })
  }

  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  if (!state || state.length > 512) return redirect({ connected: false, code: 'oauth_state_invalid' })
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const stateHash = await sha256StateHash(state)
  const { data: claimData, error: claimError } = await service.rpc('claim_gmail_oauth_callback', {
    p_state_hash: stateHash,
  })
  const claim = claimError ? null : claimedRequest(claimData)
  if (!claim) return redirect({ connected: false, code: 'oauth_state_invalid' })
  if (claim.claim_outcome === 'INVALID') return redirect({ connected: false, code: 'oauth_state_invalid' })
  if (claim.claim_outcome === 'EXPIRED') return redirect({ connected: false, code: 'oauth_state_expired' })
  if (claim.claim_outcome !== 'CLAIMED') return redirect({ connected: false, code: 'oauth_state_replayed' })
  if (!claim.request_id || !claim.nonce || !claim.pkce_code_verifier) {
    return redirect({ connected: false, code: 'oauth_state_invalid' })
  }

  const fail = async (code: GmailPublicErrorCode) => {
    await service.rpc('fail_gmail_oauth_request', {
      p_request_id: claim.request_id,
      p_safe_error_code: code,
    })
    return redirect({ connected: false, code })
  }

  const providerError = url.searchParams.get('error')
  if (providerError) {
    return fail(providerError === 'access_denied' ? 'oauth_access_denied' : 'invalid_request')
  }
  const code = url.searchParams.get('code')
  if (!code || code.length > 4096) return fail('oauth_code_missing')

  const tokenResult = await exchangeAuthorizationCode({
    code,
    codeVerifier: claim.pkce_code_verifier,
    clientId,
    clientSecret,
    redirectUri,
  })
  if (!tokenResult.ok) return fail(tokenResult.code)
  if (!tokenResult.value.refreshToken) return fail('refresh_token_missing')
  if (!hasRequiredGrantedScopes(tokenResult.value.grantedScopes)) return fail('required_scope_missing')

  const identityResult = await verifyGoogleIdToken({
    idToken: tokenResult.value.idToken,
    clientId,
    expectedNonce: claim.nonce,
  })
  if (!identityResult.ok) return fail(identityResult.code)

  const { error: persistenceError } = await service.rpc('complete_gmail_account_connection', {
    p_request_id: claim.request_id,
    p_provider_account_subject: identityResult.identity.subject,
    p_email_address: identityResult.identity.email,
    p_display_name: identityResult.identity.displayName,
    p_granted_scopes: tokenResult.value.grantedScopes,
    p_refresh_token: tokenResult.value.refreshToken,
  })
  if (persistenceError) return fail('persistence_error')
  return redirect({ connected: true })
})

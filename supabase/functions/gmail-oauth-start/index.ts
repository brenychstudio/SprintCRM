import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  buildGoogleAuthorizationUrl,
  createOAuthMaterial,
  gmailCorsHeaders,
  gmailOAuthScopes,
  isGmailEnabled,
  type GmailPublicErrorCode,
} from '../_shared/gmail-oauth.ts'

const jsonHeaders = { 'Content-Type': 'application/json' }

function jsonError(code: GmailPublicErrorCode, cors: HeadersInit, status: number) {
  return new Response(JSON.stringify({ ok: false, code }), {
    status,
    headers: { ...cors, ...jsonHeaders },
  })
}

Deno.serve(async (request) => {
  const appBaseUrl = Deno.env.get('APP_BASE_URL') ?? ''
  const cors = gmailCorsHeaders(request.headers.get('origin'), appBaseUrl)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return jsonError('invalid_request', cors, 405)
  if (!isGmailEnabled(Deno.env.get('GMAIL_CONNECTION_ENABLED'))) {
    return jsonError('gmail_disabled', cors, 503)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
  const redirectUri = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI')
  const authorization = request.headers.get('authorization')
  if (!supabaseUrl || !anonKey || !clientId || !redirectUri || !appBaseUrl) {
    return jsonError('provider_unavailable', cors, 503)
  }
  if (!authorization) return jsonError('unauthorized', cors, 401)

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  })
  const [{ data: authData, error: authError }, { data: organizationId, error: organizationError }] = await Promise.all([
    userClient.auth.getUser(),
    userClient.rpc('current_org_id'),
  ])
  if (authError || !authData.user || organizationError || typeof organizationId !== 'string') {
    return jsonError('unauthorized', cors, 401)
  }

  const material = await createOAuthMaterial()
  const requestId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const { data, error } = await userClient.rpc('create_gmail_oauth_request', {
    p_organization_id: organizationId,
    p_request_id: requestId,
    p_state_hash: material.stateHash,
    p_nonce: material.nonce,
    p_pkce_code_verifier: material.codeVerifier,
    p_requested_scopes: [...gmailOAuthScopes],
    p_expires_at: expiresAt,
  })
  if (error || !data) return jsonError('persistence_error', cors, 500)

  const authorizationUrl = buildGoogleAuthorizationUrl({
    clientId,
    redirectUri,
    state: material.state,
    nonce: material.nonce,
    codeChallenge: material.codeChallenge,
  })
  return new Response(JSON.stringify({
    ok: true,
    authorization_url: authorizationUrl,
    request_id: requestId,
    expires_at: expiresAt,
  }), { status: 200, headers: { ...cors, ...jsonHeaders } })
})

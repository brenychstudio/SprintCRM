import { createClient } from 'npm:@supabase/supabase-js@2.97.0'
import {
  gmailCorsHeaders,
  isGmailEnabled,
  revokeGoogleToken,
  type GmailPublicErrorCode,
} from '../_shared/gmail-oauth.ts'

const jsonHeaders = { 'Content-Type': 'application/json' }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(code: GmailPublicErrorCode, cors: HeadersInit, status: number) {
  return new Response(JSON.stringify({ ok: false, code }), {
    status,
    headers: { ...cors, ...jsonHeaders },
  })
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value
  return row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : null
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
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('authorization')
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !appBaseUrl) {
    return jsonError('provider_unavailable', cors, 503)
  }
  if (!authorization) return jsonError('unauthorized', cors, 401)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('invalid_request', cors, 400)
  }
  const mailboxAccountId = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>).mailbox_account_id
    : null
  if (typeof mailboxAccountId !== 'string' || !uuidPattern.test(mailboxAccountId)) {
    return jsonError('invalid_request', cors, 400)
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return jsonError('unauthorized', cors, 401)
  const { data: account, error: accountError } = await userClient
    .from('mailbox_accounts')
    .select('id,organization_id,status')
    .eq('id', mailboxAccountId)
    .maybeSingle()
  if (accountError || !account) return jsonError('unauthorized', cors, 404)

  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const { data: credentialData, error: credentialError } = await service.rpc('get_gmail_refresh_credential', {
    p_mailbox_account_id: mailboxAccountId,
  })
  const credential = credentialError ? null : firstRow(credentialData)
  const refreshToken = typeof credential?.refresh_token === 'string' ? credential.refresh_token : null
  const revocationOutcome = refreshToken ? await revokeGoogleToken(refreshToken) : 'already_invalid'
  const safeErrorCode = credentialError || revocationOutcome === 'unconfirmed' ? 'disconnect_failed' : null

  const { data: disconnectData, error: disconnectError } = await service.rpc('complete_gmail_account_disconnect', {
    p_mailbox_account_id: mailboxAccountId,
    p_actor_user_id: authData.user.id,
    p_revocation_outcome: revocationOutcome,
    p_safe_error_code: safeErrorCode,
  })
  const disconnected = disconnectError ? null : firstRow(disconnectData)
  if (!disconnected) return jsonError('disconnect_failed', cors, 500)
  return new Response(JSON.stringify({
    ok: true,
    mailbox_account_id: mailboxAccountId,
    status: 'disconnected',
    revocation_outcome: revocationOutcome,
  }), { status: 200, headers: { ...cors, ...jsonHeaders } })
})

import { FunctionsHttpError } from '@supabase/supabase-js'
import { databaseSupabase as supabase } from '../../lib/supabase'
import type { Tables } from '../../lib/supabase/database.types'

type MailboxAccountRow = Pick<Tables<'mailbox_accounts'>,
  | 'id'
  | 'provider'
  | 'email_address'
  | 'display_name'
  | 'status'
  | 'granted_scopes'
  | 'connected_at'
  | 'last_verified_at'
  | 'reauthorization_required_at'
  | 'disconnected_at'
  | 'last_revocation_outcome'
  | 'last_safe_error_code'
>

export const gmailMailboxStatuses = [
  'connected', 'reauthorization_required', 'disconnected', 'revoked', 'error',
] as const
export type GmailMailboxStatus = (typeof gmailMailboxStatuses)[number]
export type MailboxAccount = Omit<MailboxAccountRow, 'provider' | 'status'> & {
  provider: 'gmail'
  status: GmailMailboxStatus
}

export const gmailConnectionErrorCodes = [
  'gmail_disabled', 'unauthorized', 'invalid_request', 'oauth_state_invalid',
  'oauth_state_expired', 'oauth_state_replayed', 'oauth_access_denied',
  'oauth_code_missing', 'token_exchange_failed', 'refresh_token_missing',
  'required_scope_missing', 'identity_invalid', 'identity_email_unverified',
  'persistence_error', 'provider_unavailable', 'disconnect_failed',
] as const

export type GmailConnectionErrorCode = (typeof gmailConnectionErrorCodes)[number] | 'request_failed'

export class GmailConnectionError extends Error {
  readonly code: GmailConnectionErrorCode

  constructor(code: GmailConnectionErrorCode) {
    super('Gmail connection request failed.')
    this.name = 'GmailConnectionError'
    this.code = code
  }
}

export const gmailQueryKeys = {
  accounts: ['gmail', 'mailbox-accounts'] as const,
}

function asMailboxAccount(row: MailboxAccountRow): MailboxAccount {
  if (row.provider !== 'gmail' || !gmailMailboxStatuses.includes(row.status as GmailMailboxStatus)) {
    throw new GmailConnectionError('request_failed')
  }
  return { ...row, provider: 'gmail', status: row.status as GmailMailboxStatus }
}

function isErrorCode(value: unknown): value is Exclude<GmailConnectionErrorCode, 'request_failed'> {
  return typeof value === 'string' && gmailConnectionErrorCodes.includes(value as (typeof gmailConnectionErrorCodes)[number])
}

async function readFunctionError(error: unknown): Promise<GmailConnectionErrorCode> {
  if (!(error instanceof FunctionsHttpError) || !(error.context instanceof Response)) return 'request_failed'
  try {
    const value: unknown = await error.context.clone().json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'request_failed'
    const code = (value as Record<string, unknown>).code
    return isErrorCode(code) ? code : 'request_failed'
  } catch {
    return 'request_failed'
  }
}

export async function listMailboxAccounts(): Promise<MailboxAccount[]> {
  const { data, error } = await supabase
    .from('mailbox_accounts')
    .select('id,provider,email_address,display_name,status,granted_scopes,connected_at,last_verified_at,reauthorization_required_at,disconnected_at,last_revocation_outcome,last_safe_error_code')
    .order('updated_at', { ascending: false })
  if (error) throw new GmailConnectionError('request_failed')
  return (data ?? []).map(asMailboxAccount)
}

export async function startGmailConnection(): Promise<{ authorizationUrl: string; requestId: string; expiresAt: string }> {
  const { data, error } = await supabase.functions.invoke('gmail-oauth-start', { body: {} })
  if (error) throw new GmailConnectionError(await readFunctionError(error))
  if (!data || data.ok !== true || typeof data.authorization_url !== 'string'
    || typeof data.request_id !== 'string' || typeof data.expires_at !== 'string') {
    throw new GmailConnectionError('request_failed')
  }
  const authorizationUrl = new URL(data.authorization_url)
  if (authorizationUrl.protocol !== 'https:' || authorizationUrl.hostname !== 'accounts.google.com') {
    throw new GmailConnectionError('request_failed')
  }
  return { authorizationUrl: authorizationUrl.toString(), requestId: data.request_id, expiresAt: data.expires_at }
}

export function redirectToGmailAuthorization(authorizationUrl: string): void {
  window.location.assign(authorizationUrl)
}

export async function disconnectGmailAccount(mailboxAccountId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('gmail-oauth-disconnect', {
    body: { mailbox_account_id: mailboxAccountId },
  })
  if (error) throw new GmailConnectionError(await readFunctionError(error))
  if (!data || data.ok !== true || data.status !== 'disconnected') {
    throw new GmailConnectionError('disconnect_failed')
  }
}

export function callbackErrorCode(value: string | null): GmailConnectionErrorCode | null {
  if (!value) return null
  return isErrorCode(value) ? value : 'request_failed'
}

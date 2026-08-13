import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { featureFlags } from '../../../features/featureFlags/featureFlags'
import {
  callbackErrorCode,
  disconnectGmailAccount,
  GmailConnectionError,
  gmailQueryKeys,
  listMailboxAccounts,
  redirectToGmailAuthorization,
  startGmailConnection,
  type GmailConnectionErrorCode,
  type MailboxAccount,
} from '../../../features/gmail/gmailApi'
import { useI18n } from '../../../i18n/i18n'

function errorTranslationKey(code: GmailConnectionErrorCode): string {
  if (code === 'gmail_disabled') return 'settings.gmail.error.disabled'
  if (code === 'unauthorized') return 'settings.gmail.error.unauthorized'
  if (code.startsWith('oauth_state_')) return 'settings.gmail.error.state'
  if (code === 'oauth_access_denied') return 'settings.gmail.error.denied'
  if (code === 'required_scope_missing') return 'settings.gmail.error.scope'
  if (code === 'identity_invalid' || code === 'identity_email_unverified') return 'settings.gmail.error.identity'
  if (code === 'provider_unavailable' || code === 'token_exchange_failed') return 'settings.gmail.error.provider'
  if (code === 'disconnect_failed') return 'settings.gmail.error.disconnect'
  return 'settings.gmail.error.generic'
}

function accountStatusKey(status: MailboxAccount['status']): string {
  return `settings.gmail.status.${status}`
}

export function SettingsPage() {
  const { lang, t } = useI18n()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const enabled = featureFlags.gmail_connection_enabled
  const [callbackResult] = useState(() => ({
    connected: searchParams.get('gmail') === 'connected',
    error: callbackErrorCode(searchParams.get('gmail_error')),
  }))
  const callbackConnected = callbackResult.connected
  const callbackError = callbackResult.error

  const accountsQuery = useQuery({
    queryKey: gmailQueryKeys.accounts,
    queryFn: listMailboxAccounts,
    enabled,
    retry: false,
  })
  const account = accountsQuery.data?.[0] ?? null

  useEffect(() => {
    if (!callbackConnected && !callbackError) return
    if (callbackConnected && enabled) void queryClient.invalidateQueries({ queryKey: gmailQueryKeys.accounts })
    navigate('/settings', { replace: true })
  }, [callbackConnected, callbackError, enabled, navigate, queryClient])

  const connectMutation = useMutation({
    mutationFn: () => startGmailConnection(),
    onSuccess: ({ authorizationUrl }) => redirectToGmailAuthorization(authorizationUrl),
  })
  const disconnectMutation = useMutation({
    mutationFn: (mailboxAccountId: string) => disconnectGmailAccount(mailboxAccountId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gmailQueryKeys.accounts }),
  })

  const operationError = useMemo(() => {
    const error = connectMutation.error ?? disconnectMutation.error
    return error instanceof GmailConnectionError ? error.code : error ? 'request_failed' : null
  }, [connectMutation.error, disconnectMutation.error])
  const visibleError = callbackError ?? operationError
  const connecting = connectMutation.isPending
  const disconnecting = disconnectMutation.isPending
  const connected = account?.status === 'connected'
  const needsReauthorization = account?.status === 'reauthorization_required'
  const callbackVerified = callbackConnected && !accountsQuery.isFetching && connected
  const callbackUnverified = callbackConnected && !accountsQuery.isFetching && !connected

  const handleDisconnect = () => {
    if (!account || !window.confirm(t('settings.gmail.disconnectConfirm'))) return
    disconnectMutation.mutate(account.id)
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6" aria-labelledby="settings-title">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{t('settings.eyebrow')}</p>
        <h1 id="settings-title" className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">{t('settings.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">{t('settings.subtitle')}</p>
      </header>

      <article className="rounded-3xl border border-zinc-200 bg-zinc-50/70 p-5 shadow-sm" data-testid="gmail-settings-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{t('settings.gmail.provider')}</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">{t('settings.gmail.title')}</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600">{t('settings.gmail.description')}</p>
          </div>
          <span className="w-fit rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700" data-testid="gmail-status">
            {!enabled
              ? t('settings.gmail.status.featureDisabled')
              : connecting
                ? t('settings.gmail.status.connecting')
                : disconnecting
                  ? t('settings.gmail.status.disconnecting')
                  : account
                    ? t(accountStatusKey(account.status))
                    : t('settings.gmail.status.notConnected')}
          </span>
        </div>

        <div className="mt-5 rounded-2xl border border-zinc-200/80 bg-white p-4">
          {!enabled ? (
            <p className="text-sm text-zinc-600">{t('settings.gmail.featureDisabled')}</p>
          ) : accountsQuery.isLoading ? (
            <p className="text-sm text-zinc-500">{t('common.loading')}</p>
          ) : accountsQuery.isError ? (
            <p className="text-sm text-red-700" role="alert">{t('settings.gmail.error.generic')}</p>
          ) : account ? (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-zinc-500">{t('settings.gmail.email')}</dt><dd className="mt-1 font-medium text-zinc-900">{account.email_address}</dd></div>
              {account.display_name ? <div><dt className="text-zinc-500">{t('settings.gmail.displayName')}</dt><dd className="mt-1 font-medium text-zinc-900">{account.display_name}</dd></div> : null}
              <div><dt className="text-zinc-500">{t('settings.gmail.connectedAt')}</dt><dd className="mt-1 font-medium text-zinc-900">{account.connected_at ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(account.connected_at)) : t('settings.gmail.notAvailable')}</dd></div>
              <div><dt className="text-zinc-500">{t('settings.gmail.capability')}</dt><dd className="mt-1 font-medium text-zinc-900">{account.granted_scopes.includes('https://www.googleapis.com/auth/gmail.send') ? t('settings.gmail.capability.send') : t('settings.gmail.capability.identity')}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-zinc-600">{t('settings.gmail.notConnected')}</p>
          )}
        </div>

        {callbackConnected && accountsQuery.isFetching ? <p className="mt-4 text-sm text-zinc-600" role="status">{t('settings.gmail.callbackVerifying')}</p> : null}
        {callbackVerified ? <p className="mt-4 text-sm text-emerald-700" role="status">{t('settings.gmail.connectedSuccess')}</p> : null}
        {callbackUnverified ? <p className="mt-4 text-sm text-red-700" role="alert">{t('settings.gmail.callbackUnverified')}</p> : null}
        {visibleError ? <p className="mt-4 text-sm text-red-700" role="alert">{t(errorTranslationKey(visibleError))}</p> : null}
        {needsReauthorization ? <p className="mt-4 text-sm text-amber-700">{t('settings.gmail.reauthorizationHint')}</p> : null}

        <div className="mt-5 flex flex-wrap gap-2">
          {enabled && (!connected || needsReauthorization) ? (
            <button
              type="button"
              onClick={() => connectMutation.mutate()}
              disabled={!enabled || connecting || disconnecting}
              className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connecting ? t('settings.gmail.connecting') : needsReauthorization || account ? t('settings.gmail.reconnect') : t('settings.gmail.connect')}
            </button>
          ) : null}
          {account && account.status !== 'disconnected' ? (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={connecting || disconnecting}
              className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {disconnecting ? t('settings.gmail.disconnecting') : t('settings.gmail.disconnect')}
            </button>
          ) : null}
        </div>

        <div className="mt-5 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500">
          <p>{t('settings.gmail.noSend')}</p>
          <p>{t('settings.gmail.noInbox')}</p>
        </div>
      </article>
    </section>
  )
}

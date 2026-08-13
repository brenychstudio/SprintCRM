// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n/i18n'
import { SettingsPage } from './SettingsPage'

const flags = vi.hoisted(() => ({ gmail_connection_enabled: true }))
vi.mock('../../../features/featureFlags/featureFlags', () => ({ featureFlags: flags }))

const api = vi.hoisted(() => {
  class TestGmailConnectionError extends Error {
    code: string
    constructor(code: string) { super('safe'); this.code = code }
  }
  return {
    listMailboxAccounts: vi.fn(),
    startGmailConnection: vi.fn(),
    redirectToGmailAuthorization: vi.fn(),
    disconnectGmailAccount: vi.fn(),
    callbackErrorCode: (value: string | null) => value || null,
    GmailConnectionError: TestGmailConnectionError,
  }
})

vi.mock('../../../features/gmail/gmailApi', () => ({
  ...api,
  gmailQueryKeys: { accounts: ['gmail', 'mailbox-accounts'] },
}))

const connectedAccount = {
  id: '11111111-1111-4111-8111-111111111111',
  provider: 'gmail',
  email_address: 'owner@example.test',
  display_name: 'Mailbox Owner',
  status: 'connected',
  granted_scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'],
  connected_at: '2026-08-12T10:00:00.000Z',
  last_verified_at: '2026-08-12T10:00:00.000Z',
  reauthorization_required_at: null,
  disconnected_at: null,
  last_revocation_outcome: null,
  last_safe_error_code: null,
}

function renderSettings(initialEntry = '/settings') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes><Route path="/settings" element={<SettingsPage />} /></Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  flags.gmail_connection_enabled = true
})

describe('Gmail Settings card', () => {
  it('shows the disabled state without an active connect control', () => {
    flags.gmail_connection_enabled = false
    renderSettings()
    expect(screen.getByTestId('gmail-status').textContent).toBe('Feature disabled')
    expect(screen.queryByRole('button', { name: 'Connect Gmail' })).toBeNull()
    expect(api.listMailboxAccounts).not.toHaveBeenCalled()
  })

  it('shows not connected and starts one explicit OAuth action', async () => {
    api.listMailboxAccounts.mockResolvedValue([])
    api.startGmailConnection.mockResolvedValue({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=safe',
      requestId: 'request-id',
      expiresAt: '2026-08-12T10:10:00.000Z',
    })
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Gmail' }))
    await waitFor(() => expect(api.startGmailConnection).toHaveBeenCalledTimes(1))
    expect(api.redirectToGmailAuthorization).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=safe')
  })

  it('shows only safe connected metadata and no send or inbox actions', async () => {
    api.listMailboxAccounts.mockResolvedValue([connectedAccount])
    renderSettings()
    expect(await screen.findByText('owner@example.test')).toBeTruthy()
    expect(screen.getByText('Mailbox Owner')).toBeTruthy()
    expect(screen.getByText('Future controlled send')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /send/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /inbox/i })).toBeNull()
    expect(screen.queryByText(/token|provider subject|vault/i)).toBeNull()
  })

  it('offers reconnect when the account requires reauthorization', async () => {
    api.listMailboxAccounts.mockResolvedValue([{ ...connectedAccount, status: 'reauthorization_required' }])
    renderSettings()
    expect(await screen.findByRole('button', { name: 'Reconnect Gmail' })).toBeTruthy()
    expect(screen.getByTestId('gmail-status').textContent).toBe('Reauthorization required')
  })

  it('preserves a concise callback success after removing transient query state', async () => {
    api.listMailboxAccounts.mockResolvedValue([connectedAccount])
    renderSettings('/settings?gmail=connected')
    expect(await screen.findByText('Gmail is connected. Authoritative account state was verified.')).toBeTruthy()
    await waitFor(() => expect(api.listMailboxAccounts).toHaveBeenCalled())
  })

  it('does not claim connection success without an authoritative account reread', async () => {
    api.listMailboxAccounts.mockResolvedValue([])
    renderSettings('/settings?gmail=connected')
    expect((await screen.findByRole('alert')).textContent).toContain('could not be verified')
    expect(screen.queryByText('Gmail is connected. Authoritative account state was verified.')).toBeNull()
  })

  it('maps callback failures to safe localized copy without raw provider detail', async () => {
    api.listMailboxAccounts.mockResolvedValue([])
    renderSettings('/settings?gmail_error=oauth_state_replayed&error_description=raw-provider-detail')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('expired or was already used')
    expect(alert.textContent).not.toContain('raw-provider-detail')
  })

  it('does not disconnect when the human cancels confirmation', async () => {
    api.listMailboxAccounts.mockResolvedValue([connectedAccount])
    vi.stubGlobal('confirm', vi.fn(() => false))
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Gmail' }))
    expect(api.disconnectGmailAccount).not.toHaveBeenCalled()
  })

  it('disconnects only after explicit confirmation', async () => {
    api.listMailboxAccounts.mockResolvedValue([connectedAccount])
    api.disconnectGmailAccount.mockResolvedValue(undefined)
    vi.stubGlobal('confirm', vi.fn(() => true))
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Gmail' }))
    await waitFor(() => expect(api.disconnectGmailAccount).toHaveBeenCalledWith(connectedAccount.id))
  })
})

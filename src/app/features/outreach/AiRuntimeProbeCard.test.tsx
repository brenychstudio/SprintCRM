// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n/i18n'
import { AiRuntimeProbeCard } from './AiRuntimeProbeCard'

const api = vi.hoisted(() => ({ getLatestAiRuntimeProbe: vi.fn(), testAiRuntimeConnection: vi.fn() }))
vi.mock('../../../features/campaigns/campaignsApi', () => ({ ...api, campaignQueryKeys: { aiRuntimeProbe: (id: string) => ['probe', id] } }))
function renderCard() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><I18nProvider><AiRuntimeProbeCard memberId="11111111-1111-4111-8111-111111111111" /></I18nProvider></QueryClientProvider>) }
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('AI runtime probe card', () => {
  it('shows pending then connected metadata without research or message mutations', async () => {
    api.getLatestAiRuntimeProbe.mockResolvedValue(null)
    let resolveProbe!: (value: unknown) => void
    api.testAiRuntimeConnection.mockReturnValue(new Promise((resolve) => { resolveProbe = resolve }))
    renderCard()
    const button = await screen.findByTestId('ai-runtime-probe-button')
    fireEvent.click(button)
    await waitFor(() => expect(button).toHaveProperty('disabled', true))
    expect(screen.getAllByText(/Testing/).length).toBeGreaterThan(0)
    resolveProbe({ ok: true, job_id: 'probe-12345678', status: 'completed', provider: 'openai', model: 'test-model', schema_version: 'runtime_probe_v1', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, total_tokens: 2 }, cost: { estimated_usd: null, status: 'not_configured' }, duration_ms: 9 })
    await waitFor(() => expect(screen.getByText((_, element) => element?.textContent === 'Status: Connected')).toBeTruthy())
    expect(screen.getByText('test-model')).toBeTruthy()
    expect(api).not.toHaveProperty('saveResearch')
    expect(api).not.toHaveProperty('saveMessage')
  })
  it('shows a safe failed state', async () => {
    api.getLatestAiRuntimeProbe.mockResolvedValue(null)
    api.testAiRuntimeConnection.mockRejectedValue(new Error('provider internals'))
    renderCard()
    fireEvent.click(await screen.findByTestId('ai-runtime-probe-button'))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText('AI connection test failed.')).toBeTruthy()
  })
})

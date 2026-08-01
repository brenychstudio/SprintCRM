// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n/i18n'
import { AiResearchCard } from './AiResearchCard'

const api = vi.hoisted(() => ({ getLatestAiResearchJob: vi.fn(), generateAiResearch: vi.fn() }))
vi.mock('../../../features/campaigns/campaignsApi', () => ({ ...api, campaignQueryKeys: { aiResearch: (id: string) => ['research', id], workspace: (campaignId: string, memberId: string) => ['workspace', campaignId, memberId], detail: (id: string) => ['campaign', id], members: (id: string) => ['members', id], leadSummary: (id: string) => ['lead', id] } }))
function renderCard(website = 'https://studio.test', researchVersion: number | null = null) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><I18nProvider><AiResearchCard memberId="11111111-1111-4111-8111-111111111111" campaignId="campaign" leadId="lead" website={website} memberStatus="queued" researchVersion={researchVersion} /></I18nProvider></QueryClientProvider>) }
afterEach(() => { cleanup(); vi.clearAllMocks() })
describe('AI research card', () => {
  it('shows pending and completed states without message or approval mutations', async () => {
    api.getLatestAiResearchJob.mockResolvedValueOnce(null).mockResolvedValue({ id: 'research-123', generation_status: 'completed', model_name: 'test-model', total_tokens: 2, duration_ms: 9, request_id: 'research-123', created_at: new Date().toISOString(), error_code: null, output_payload: { confidence: 0.7, evidence: [{ url: 'https://studio.test', note: 'Public fact' }] } })
    let resolve!: (value: unknown) => void
    api.generateAiResearch.mockReturnValue(new Promise((done) => { resolve = done }))
    renderCard('https://studio.test', 2)
    const button = await screen.findByTestId('ai-research-button')
    fireEvent.click(button)
    await waitFor(() => expect(button).toHaveProperty('disabled', true))
    resolve({ ok: true, job_id: 'research-123', research_snapshot_id: 'snapshot', research_version: 3, status: 'completed', provider: 'openai', model: 'test-model', schema_version: 'research_v2', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, total_tokens: 2 }, cost: { estimated_usd: null, status: 'not_configured' }, duration_ms: 9, source_count: 1 })
    await waitFor(() => expect(screen.getByText('test-model')).toBeTruthy())
    expect(screen.getByText('Version 2')).toBeTruthy()
    expect(api).not.toHaveProperty('saveMessage')
    expect(api).not.toHaveProperty('approveMessage')
  })
  it('shows website-required state and disables generation', async () => {
    api.getLatestAiResearchJob.mockResolvedValue(null)
    renderCard('https://example.com')
    const button = await screen.findByTestId('ai-research-button')
    expect(button).toHaveProperty('disabled', true)
    expect(screen.getByText(/Website required/)).toBeTruthy()
  })
})

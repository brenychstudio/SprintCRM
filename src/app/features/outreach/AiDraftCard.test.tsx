// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n/i18n'
import { AiDraftCard } from './AiDraftCard'

const api = vi.hoisted(() => ({ getLatestAiDraftJob: vi.fn(), generateAiDraft: vi.fn() }))
vi.mock('../../../features/campaigns/campaignsApi', () => ({ ...api, campaignQueryKeys: { all: ['campaigns'], aiDraft: (id: string) => ['draft', id], workspace: (campaignId: string, memberId: string) => ['workspace', campaignId, memberId], detail: (id: string) => ['campaign', id], members: (id: string) => ['members', id], leadSummary: (id: string) => ['lead', id] } }))

const research = { id: '22222222-2222-4222-8222-222222222222', campaign_member_id: '11111111-1111-4111-8111-111111111111', version: 2, observed_opportunity: 'Public opportunity', recommended_offer: 'Offer', recommended_case: null, evidence: [], confidence: null, warnings: [], created_at: new Date().toISOString() }
function renderCard(status: 'research_ready' | 'needs_review' = 'research_ready') { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><I18nProvider><AiDraftCard memberId="11111111-1111-4111-8111-111111111111" campaignId="campaign" leadId="lead" memberStatus={status} latestResearch={research} latestMessage={null} /></I18nProvider></QueryClientProvider>) }
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('AI draft card', () => {
  it('requires research confirmation and prevents duplicate clicks while pending', async () => {
    api.getLatestAiDraftJob.mockResolvedValue(null)
    let resolve!: (result: unknown) => void
    api.generateAiDraft.mockReturnValue(new Promise((done) => { resolve = done }))
    renderCard()
    const button = await screen.findByTestId('ai-draft-button')
    expect(button).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByTestId('ai-draft-confirmation'))
    expect(button).toHaveProperty('disabled', false)
    fireEvent.click(button)
    await waitFor(() => expect(button).toHaveProperty('disabled', true))
    expect(api.generateAiDraft).toHaveBeenCalledTimes(1)
    resolve({ ok: true, job_id: 'job', request_id: 'request', status: 'completed', provider: 'openai', model: 'test', schema_version: 'draft_v1', message_version: 1, research_version: 2, usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 2, total_tokens: 3 }, cost: { estimated_usd: null, status: 'not_configured' }, duration_ms: 10 })
    expect(await screen.findByText(/AI-generated draft must be reviewed/i)).toBeTruthy()
  })

  it('does not offer generation after review starts', async () => {
    api.getLatestAiDraftJob.mockResolvedValue(null)
    renderCard('needs_review')
    const button = await screen.findByTestId('ai-draft-button')
    fireEvent.click(screen.getByTestId('ai-draft-confirmation'))
    expect(button).toHaveProperty('disabled', true)
  })
})

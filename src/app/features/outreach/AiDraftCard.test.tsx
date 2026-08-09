// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n/i18n'
import { AiDraftCard } from './AiDraftCard'

const api = vi.hoisted(() => {
  class TestAiDraftGenerationError extends Error {
    code: string
    constructor(code: string, message = 'Safe server failure') { super(message); this.code = code }
  }
  return { getLatestAiDraftJob: vi.fn(), generateAiDraft: vi.fn(), AiDraftGenerationError: TestAiDraftGenerationError }
})
vi.mock('../../../features/campaigns/campaignsApi', () => ({ ...api, campaignQueryKeys: { all: ['campaigns'], aiDraft: (id: string) => ['draft', id], workspace: (campaignId: string, memberId: string) => ['workspace', campaignId, memberId], detail: (id: string) => ['campaign', id], members: (id: string) => ['members', id], leadSummary: (id: string) => ['lead', id] } }))

const memberId = '11111111-1111-4111-8111-111111111111'
const research = { id: '22222222-2222-4222-8222-222222222222', campaign_member_id: memberId, version: 2, observed_opportunity: 'Public opportunity', recommended_offer: 'Offer', recommended_case: null, evidence: [], confidence: null, warnings: [], created_at: new Date().toISOString() }
const historicalFailure = { id: 'job-historical', generation_status: 'failed' as const, model_name: 'test-model', total_tokens: 994, duration_ms: 10, request_id: 'e1eb420a-241c-46a4-a471-0730a05e8abc', created_at: new Date().toISOString(), error_code: 'draft_validation:body_missing_low_pressure_cta' }
const completedJob = { ...historicalFailure, id: 'job-completed', generation_status: 'completed' as const, request_id: 'completed-request' }
const success = { ok: true as const, job_id: 'job-completed', request_id: 'server-request', status: 'completed' as const, provider: 'openai' as const, model: 'test', schema_version: 'draft_v1' as const, message_version: 1, research_version: 2, usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 2, total_tokens: 3 }, cost: { estimated_usd: null, status: 'not_configured' as const }, duration_ms: 10 }
type LatestMessage = { id: string; campaign_member_id: string; version: number; source: 'ai'; ai_generation_id: string; channel: 'email'; language: 'en'; subject: string; body: string; status: 'draft'; research_snapshot_id: string; approved_by: null; approved_at: null; created_at: string; updated_at: string }

function messageFor(jobId: string, version: number): LatestMessage {
  return { id: `message-${version}`, campaign_member_id: memberId, version, source: 'ai', ai_generation_id: jobId, channel: 'email', language: 'en', subject: 'Subject', body: 'Body', status: 'draft', research_snapshot_id: research.id, approved_by: null, approved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
}

function renderCard({ memberStatus = 'research_ready' as const, latestMessage = null }: { memberStatus?: 'research_ready' | 'needs_review'; latestMessage?: LatestMessage | null } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const card = (nextMessage: LatestMessage | null, nextStatus = memberStatus) => <QueryClientProvider client={client}><I18nProvider><AiDraftCard memberId={memberId} campaignId="campaign" leadId="lead" memberStatus={nextStatus} latestResearch={research} latestMessage={nextMessage} /></I18nProvider></QueryClientProvider>
  const view = render(card(latestMessage))
  return { client, rerenderCard: (nextMessage: LatestMessage | null, nextStatus = memberStatus) => view.rerender(card(nextMessage, nextStatus)), ...view }
}

function confirmResearch() { fireEvent.click(screen.getByTestId('ai-draft-confirmation')) }
function statusIs(value: string) { return screen.getByText(`Status: ${value}`) }
function useRequestIds(...ids: string[]) { vi.stubGlobal('crypto', { randomUUID: vi.fn(() => ids.shift() ?? 'ffffffff-ffff-4fff-8fff-ffffffffffff') }) }

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('AI draft card', () => {
  it('shows a failed persisted job as neutral history, not the current status', async () => {
    api.getLatestAiDraftJob.mockResolvedValue(historicalFailure)
    renderCard()
    expect((await screen.findByTestId('ai-draft-previous-failure')).textContent).toContain('Previous AI draft attempt: Failed: e1eb420a')
    expect(statusIs('Confirmation required')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps Generate available after confirmation when history contains a failed job', async () => {
    api.getLatestAiDraftJob.mockResolvedValue(historicalFailure)
    renderCard()
    await screen.findByTestId('ai-draft-previous-failure')
    confirmResearch()
    expect(screen.getByTestId('ai-draft-button')).toHaveProperty('disabled', false)
  })

  it('uses one client request ID, shows it while generating, and prevents duplicate clicks', async () => {
    useRequestIds('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    api.getLatestAiDraftJob.mockResolvedValue(null)
    let resolve!: (result: unknown) => void
    api.generateAiDraft.mockReturnValue(new Promise((done) => { resolve = done }))
    renderCard()
    await screen.findByTestId('ai-draft-button')
    confirmResearch()
    const button = screen.getByTestId('ai-draft-button')
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(statusIs('Generating')).toBeTruthy())
    expect(screen.getByTestId('ai-draft-attempt-id').textContent).toContain('Attempt ID: aaaaaaaa')
    expect(api.generateAiDraft).toHaveBeenCalledTimes(1)
    expect(api.generateAiDraft).toHaveBeenCalledWith(memberId, research.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(button).toHaveProperty('disabled', true)
    resolve(success)
  })

  it('shows the safe code and local attempt ID for a current pre-ledger failure', async () => {
    useRequestIds('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    api.getLatestAiDraftJob.mockResolvedValue(null)
    api.generateAiDraft.mockRejectedValue(new api.AiDraftGenerationError('request_failed'))
    renderCard()
    await screen.findByTestId('ai-draft-button')
    confirmResearch()
    fireEvent.click(screen.getByTestId('ai-draft-button'))
    expect((await screen.findByRole('alert')).textContent).toContain('AI draft generation failed. No message version was saved.')
    expect(statusIs('Failed')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Error: request_failed')
    expect(screen.getByRole('alert').textContent).toContain('Attempt ID: bbbbbbbb')
  })

  it('does not leak an internal validator reason from a current invalid-provider response', async () => {
    useRequestIds('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
    api.getLatestAiDraftJob.mockResolvedValue(null)
    api.generateAiDraft.mockRejectedValue(new api.AiDraftGenerationError('invalid_provider_response', 'draft_validation:body_missing_low_pressure_cta'))
    renderCard()
    await screen.findByTestId('ai-draft-button')
    confirmResearch()
    fireEvent.click(screen.getByTestId('ai-draft-button'))
    expect((await screen.findByRole('alert')).textContent).toContain('Error: invalid_provider_response')
    expect(screen.queryByText(/draft_validation:body_missing_low_pressure_cta/)).toBeNull()
  })

  it('restores Completed from a matching persisted job after refresh', async () => {
    api.getLatestAiDraftJob.mockResolvedValue(completedJob)
    renderCard({ latestMessage: messageFor(completedJob.id, 1) })
    expect(await screen.findByText('Status: Completed')).toBeTruthy()
  })

  it('keeps a successful current attempt completed when the query still has a historical failure', async () => {
    useRequestIds('dddddddd-dddd-4ddd-8ddd-dddddddddddd')
    api.getLatestAiDraftJob.mockResolvedValue(historicalFailure)
    api.generateAiDraft.mockResolvedValue(success)
    renderCard()
    await screen.findByTestId('ai-draft-previous-failure')
    confirmResearch()
    fireEvent.click(screen.getByTestId('ai-draft-button'))
    expect(await screen.findByText('Status: Completed')).toBeTruthy()
  })

  it('shows the latest persisted Job B metadata when Message V2 advances on the same Research V2', async () => {
    useRequestIds('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    const jobA = { ...completedJob, id: 'job-a', request_id: '32b236b5-fa11-47d8-88b5-f582f541dcd6', total_tokens: 1011, duration_ms: 3788 }
    const jobB = { ...completedJob, id: 'job-b', request_id: 'c642cfbf-bb58-489e-9c06-aeeb5ce6bc16', total_tokens: 1184, duration_ms: 3261 }
    const attemptA = { ...success, job_id: jobA.id, request_id: jobA.request_id, message_version: 1, usage: { ...success.usage, total_tokens: 1011 }, duration_ms: 3788 }
    api.getLatestAiDraftJob.mockResolvedValue(jobA)
    api.generateAiDraft.mockResolvedValue(attemptA)
    const { client, rerenderCard } = renderCard({ latestMessage: messageFor(jobA.id, 1) })
    await screen.findByText('Status: Completed')
    confirmResearch()
    fireEvent.click(screen.getByTestId('ai-draft-button'))
    await waitFor(() => expect(screen.getByTestId('ai-draft-metadata-id').textContent).toBe('32b236b5'))

    client.setQueryData(['draft', memberId], jobB)
    rerenderCard(messageFor(jobB.id, 2))

    expect(screen.getByTestId('ai-draft-message-version').textContent).toBe('2')
    expect(screen.getByTestId('ai-draft-total-tokens').textContent).toBe('1184')
    expect(screen.getByTestId('ai-draft-duration').textContent).toBe('3261 ms')
    expect(screen.getByTestId('ai-draft-metadata-id').textContent).toBe('c642cfbf')
  })

  it('does not let a refetched historical failure replace the current generating attempt', async () => {
    useRequestIds('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
    api.getLatestAiDraftJob.mockResolvedValue(null)
    api.generateAiDraft.mockReturnValue(new Promise(() => {}))
    const { client } = renderCard()
    await screen.findByTestId('ai-draft-button')
    confirmResearch()
    fireEvent.click(screen.getByTestId('ai-draft-button'))
    client.setQueryData(['draft', memberId], historicalFailure)
    expect(await screen.findByText('Status: Generating')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('replaces the old attempt ID only for a new explicit attempt and never retries automatically', async () => {
    useRequestIds('ffffffff-ffff-4fff-8fff-ffffffffffff', '99999999-9999-4999-8999-999999999999')
    api.getLatestAiDraftJob.mockResolvedValue(null)
    api.generateAiDraft.mockRejectedValue(new api.AiDraftGenerationError('provider_timeout'))
    renderCard()
    await screen.findByTestId('ai-draft-button')
    confirmResearch()
    fireEvent.click(screen.getByTestId('ai-draft-button'))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('Attempt ID: ffffffff')
    expect(api.generateAiDraft).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('ai-draft-button'))
    await waitFor(() => expect(api.generateAiDraft).toHaveBeenCalledTimes(2))
    expect(api.generateAiDraft.mock.calls.map((call: unknown[]) => call[2])).toEqual(['ffffffff-ffff-4fff-8fff-ffffffffffff', '99999999-9999-4999-8999-999999999999'])
  })

  it('preserves responsive and dark-theme card classes', async () => {
    api.getLatestAiDraftJob.mockResolvedValue(null)
    renderCard()
    const card = await screen.findByTestId('ai-draft')
    expect(card.className).toContain('min-w-0')
    expect(card.className).toContain('dark:bg-zinc-900')
    expect(screen.getByTestId('ai-draft-button').className).toContain('shrink-0')
  })

  it('does not offer generation after review starts', async () => {
    api.getLatestAiDraftJob.mockResolvedValue(null)
    renderCard({ memberStatus: 'needs_review' })
    await screen.findByTestId('ai-draft-button')
    confirmResearch()
    expect(screen.getByTestId('ai-draft-button')).toHaveProperty('disabled', true)
  })
})

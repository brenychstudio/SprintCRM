// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n/i18n'
import { OutreachTodaySummary } from './OutreachTodaySummary'

const api = vi.hoisted(() => ({ outreachTaskCounts: vi.fn() }))

vi.mock('../../../features/campaigns/campaignsApi', () => ({
  ...api,
  campaignQueryKeys: { tasks: () => ['campaigns', 'tasks'] },
}))

function renderSummary() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><I18nProvider><MemoryRouter><OutreachTodaySummary /></MemoryRouter></I18nProvider></QueryClientProvider>)
}

afterEach(() => vi.clearAllMocks())

describe('OutreachTodaySummary', () => {
  it('disables Open next task and explains the empty queue', async () => {
    api.outreachTaskCounts.mockResolvedValue({ needsReview: 0, researchRequired: 0, needsAttention: 0 })
    renderSummary()

    expect(await screen.findByText('No outreach tasks right now')).toBeTruthy()
    expect(screen.getByTestId('today-outreach-open-disabled')).toHaveProperty('disabled', true)
    expect(screen.queryByRole('link', { name: 'Open next task' })).toBeNull()
  })

  it('keeps the Campaigns link active when actionable work exists', async () => {
    api.outreachTaskCounts.mockResolvedValue({ needsReview: 1, researchRequired: 0, needsAttention: 0 })
    renderSummary()

    const link = await screen.findByRole('link', { name: 'Open next task' })
    expect(link.getAttribute('href')).toBe('/campaigns')
  })
})

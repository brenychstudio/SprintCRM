// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n/i18n'
import { OutreachDrawerSummary } from './OutreachDrawerSummary'

const api = vi.hoisted(() => ({ listCampaignSummariesForLead: vi.fn() }))

vi.mock('../../../features/campaigns/campaignsApi', () => ({
  ...api,
  campaignQueryKeys: { leadSummary: (leadId: string) => ['campaigns', 'lead', leadId] },
}))

vi.mock('../../../features/featureFlags/featureFlags', () => ({
  featureFlags: { outreach_ops_enabled: true },
}))

describe('OutreachDrawerSummary', () => {
  it('shows the latest research and message versions for the selected campaign member', async () => {
    api.listCampaignSummariesForLead.mockResolvedValue([{
      campaign: { id: 'campaign-1', name: 'Hospitality studios' },
      member: { id: 'member-1', status: 'draft_ready' },
      latestResearch: { version: 2 },
      latestMessage: { version: 3 },
    }])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><I18nProvider><MemoryRouter><OutreachDrawerSummary leadId="lead-1" /></MemoryRouter></I18nProvider></QueryClientProvider>)

    expect(await screen.findByText('Research')).toBeTruthy()
    expect(screen.getByText('Message')).toBeTruthy()
    expect(screen.getByText('Version 2')).toBeTruthy()
    expect(screen.getByText('Version 3')).toBeTruthy()
  })
})

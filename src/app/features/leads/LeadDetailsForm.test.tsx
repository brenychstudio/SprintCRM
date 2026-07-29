// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { I18nProvider } from '../../../i18n/i18n'
import type { Lead } from '../../../features/leads/types'
import { LeadDetailsForm } from './LeadDetailsForm'
import { LeadsPage } from '../../pages/leads/LeadsPage'

const api = vi.hoisted(() => ({
  createLeadFromDetails: vi.fn(),
  findLeadDuplicates: vi.fn(),
  getLeadForEdit: vi.fn(),
  listLeads: vi.fn(),
  updateLeadDetails: vi.fn(),
}))

vi.mock('../../../features/leads/leadsApi', () => ({
  ...api,
  LeadUniqueViolationError: class LeadUniqueViolationError extends Error {},
  leadsQueryKeys: { all: ['leads'], list: (filters: unknown) => ['leads', filters], detail: (id: string) => ['leads', 'detail', id] },
}))

vi.mock('../../../features/campaigns/campaignsApi', () => ({
  campaignQueryKeys: { all: ['campaigns'] },
}))

function savedLead(): Lead {
  return { id: 'lead-1', company_name: 'Saved Studio' } as Lead
}

function renderRouter(initialPath: string, element: React.ReactNode) {
  const router = createMemoryRouter([
    { path: '/leads', element: <div>lead-list</div> },
    { path: '/leads/new', element },
    { path: '/leads/:leadId/edit', element },
  ], { initialEntries: [initialPath] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><I18nProvider><RouterProvider router={router} /></I18nProvider></QueryClientProvider>)
}

beforeEach(() => {
  api.findLeadDuplicates.mockResolvedValue([])
  api.createLeadFromDetails.mockResolvedValue(savedLead())
  api.listLeads.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

describe('manual lead form', () => {
  it('opens create without inserting and Cancel creates no row', async () => {
    const user = userEvent.setup()
    renderRouter('/leads/new', <LeadDetailsForm mode="create" />)
    expect(api.createLeadFromDetails).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(/Company name/), 'Unsaved Studio')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
    expect(await screen.findByText('lead-list')).toBeTruthy()
    expect(api.createLeadFromDetails).not.toHaveBeenCalled()
  })

  it('saves one populated lead and guards a double submit', async () => {
    const user = userEvent.setup()
    renderRouter('/leads/new', <LeadDetailsForm mode="create" />)
    await user.type(screen.getByLabelText(/Company name/), 'Saved Studio')
    await user.type(screen.getByLabelText('Email'), 'hello@example.com')
    await user.dblClick(screen.getByTestId('lead-save'))
    await waitFor(() => expect(api.createLeadFromDetails).toHaveBeenCalledTimes(1))
    expect(api.createLeadFromDetails.mock.calls[0][0]).toMatchObject({ company_name: 'Saved Studio', email: 'hello@example.com' })
  })

  it('rejects an invalid email without creating a row', async () => {
    const user = userEvent.setup()
    renderRouter('/leads/new', <LeadDetailsForm mode="create" />)
    await user.type(screen.getByLabelText(/Company name/), 'Invalid Email Studio')
    await user.type(screen.getByLabelText('Email'), 'not-an-email')
    await user.click(screen.getByTestId('lead-save'))
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy()
    expect(api.createLeadFromDetails).not.toHaveBeenCalled()
  })

  it('blocks an exact identifier duplicate', async () => {
    const user = userEvent.setup()
    api.findLeadDuplicates.mockResolvedValue([{ lead: savedLead(), kinds: ['email'], exactIdentifier: true }])
    renderRouter('/leads/new', <LeadDetailsForm mode="create" />)
    await user.type(screen.getByLabelText(/Company name/), 'Duplicate Studio')
    await user.type(screen.getByLabelText('Email'), 'hello@example.com')
    await user.click(screen.getByTestId('lead-save'))
    expect(await screen.findByText('A lead with this contact information already exists.')).toBeTruthy()
    expect(api.createLeadFromDetails).not.toHaveBeenCalled()
  })

  it('loads and persists existing lead details', async () => {
    const user = userEvent.setup()
    const lead = {
      ...savedLead(),
      contact_name: 'Old Contact',
      email: 'old@example.com',
      phone: null,
      website: 'https://example.com',
      niche: null,
      country_city: null,
      preferred_channel: 'email',
      language: 'en',
      notes: null,
    } as Lead
    api.updateLeadDetails.mockResolvedValue({ ...lead, company_name: 'Updated Studio' })
    renderRouter('/leads/lead-1/edit', <LeadDetailsForm mode="edit" lead={lead} />)

    const company = screen.getByLabelText(/Company name/)
    expect((company as HTMLInputElement).value).toBe('Saved Studio')
    await user.clear(company)
    await user.type(company, 'Updated Studio')
    await user.click(screen.getByTestId('lead-save'))

    await waitFor(() => expect(api.updateLeadDetails).toHaveBeenCalledTimes(1))
    expect(api.updateLeadDetails).toHaveBeenCalledWith(
      'lead-1',
      expect.objectContaining({ company_name: 'Updated Studio', email: 'old@example.com' }),
      ['company_name'],
    )
  })

  it('New lead navigates to the focused create route', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter([
      { path: '/leads', element: <LeadsPage /> },
      { path: '/leads/new', element: <div>focused-create-route</div> },
    ], { initialEntries: ['/leads'] })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><I18nProvider><RouterProvider router={router} /></I18nProvider></QueryClientProvider>)
    await user.click(await screen.findByTestId('lead-create'))
    expect(await screen.findByText('focused-create-route')).toBeTruthy()
    expect(api.createLeadFromDetails).not.toHaveBeenCalled()
  })
})

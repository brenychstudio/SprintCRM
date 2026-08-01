// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../../i18n/i18n'
import type { ResearchEvidence } from '../../../features/campaigns/types'
import { contactNameOrFallback, ResearchEvidenceCards } from './CampaignWorkspacePage'

function EvidenceHarness() {
  const [evidence, setEvidence] = useState<ResearchEvidence[]>([{ url: 'https://hotel.example.com/a/very/long/path/to/a/page', note: 'The public page clearly presents the hotel’s rooms, services, and visitor-facing information.' }])
  return <I18nProvider><ResearchEvidenceCards evidence={evidence} setEvidence={setEvidence} /></I18nProvider>
}

afterEach(cleanup)
describe('campaign workspace research review', () => {
  it('renders a responsive reviewable evidence card with its full note and safe external link', () => {
    render(<EvidenceHarness />)
    const link = screen.getByRole('link', { name: 'https://hotel.example.com/a/very/long/path/to/a/page' })
    expect(link.getAttribute('href')).toBe('https://hotel.example.com/a/very/long/path/to/a/page')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByDisplayValue('The public page clearly presents the hotel’s rooms, services, and visitor-facing information.')).toBeTruthy()
    expect(screen.getByTestId('research-evidence-cards').className).toContain('md:grid-cols-2')
    expect(link.className).toContain('break-all')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('uses a neutral localized fallback for a missing contact person', () => {
    expect(contactNameOrFallback(null, 'Contact person not specified')).toBe('Contact person not specified')
    expect(contactNameOrFallback('  Ana  ', 'Contact person not specified')).toBe('Ana')
  })
})

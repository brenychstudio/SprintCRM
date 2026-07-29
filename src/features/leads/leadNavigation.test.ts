import { describe, expect, it } from 'vitest'
import { leadDrawerTarget, safeLeadReturnTarget } from './leadNavigation'

describe('lead navigation', () => {
  it('accepts only allowlisted internal campaign Leads-step targets', () => {
    expect(safeLeadReturnTarget('/campaigns/123e4567-e89b-12d3-a456-426614174000/edit?step=leads')).toBe(
      '/campaigns/123e4567-e89b-12d3-a456-426614174000/edit?step=leads',
    )
    expect(safeLeadReturnTarget('/campaigns/new?step=leads')).toBe('/campaigns/new?step=leads')
    expect(safeLeadReturnTarget('https://evil.example')).toBe('/leads')
    expect(safeLeadReturnTarget('//evil.example')).toBe('/leads')
    expect(safeLeadReturnTarget('/reports')).toBe('/leads')
  })

  it('builds the canonical Drawer URL', () => {
    expect(leadDrawerTarget('lead id')).toBe('/leads?open=lead%20id')
  })
})

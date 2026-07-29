import { describe, expect, it } from 'vitest'
import {
  changedLeadDetailFields,
  classifyLeadDuplicates,
  emptyLeadDetails,
  normalizeLeadDetails,
  normalizeWebsiteForSave,
  validateLeadDetails,
} from './leadDetails'
import type { Lead } from './types'

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1', org_id: 'org-1', owner: 'user-1', created_by: 'user-1', company_name: 'Example Studio',
    website: 'https://example.com', website_domain: 'example.com', niche: null, country_city: null,
    contact_name: null, email: 'hello@example.com', phone: '+34 600 111 222', source_file: null,
    stage: 'new', status: 'active', last_touch_at: '2026-07-29T10:00:00Z', next_action: 'follow_up',
    next_action_at: '2026-08-01T10:00:00Z', notes: null, revenue: null, preferred_channel: null,
    language: null, service_interest: null, offer_type: null, observed_issue: null, reply_status: null,
    current_outreach_generation_id: null, current_outreach_subject: null, current_outreach_body: null,
    current_outreach_variant: null, current_outreach_channel: null, current_outreach_personalization_notes: null,
    outreach_generated_at: null, outreach_edited_manually: false, sent_at: null,
    email_norm: 'hello@example.com', website_domain_norm: 'example.com', phone_norm: '+34600111222',
    created_at: '2026-07-29T10:00:00Z', updated_at: '2026-07-29T10:00:00Z',
    ...overrides,
  }
}

describe('lead details', () => {
  it('validates the required company and contact formats', () => {
    expect(validateLeadDetails({ ...emptyLeadDetails(), email: 'bad email', website: 'not a url' })).toEqual({
      company_name: 'required', email: 'invalid', website: 'invalid',
    })
  })

  it('normalizes website, email and nullable fields without losing phone formatting', () => {
    const normalized = normalizeLeadDetails({
      ...emptyLeadDetails(), company_name: '  Example Studio  ', email: ' HELLO@EXAMPLE.COM ',
      phone: ' +34 600 111 222 ', website: 'example.com/path', notes: '   ',
    })
    expect(normalizeWebsiteForSave('example.com/path')).toBe('https://example.com/path')
    expect(normalized).toMatchObject({
      company_name: 'Example Studio', email: 'hello@example.com', phone: '+34 600 111 222',
      website: 'https://example.com/path', website_domain: 'example.com', notes: null,
    })
  })

  it.each([
    ['email', { email: 'HELLO@example.com' }],
    ['domain', { website: 'https://www.example.com/about' }],
    ['phone', { phone: '+34 (600) 111-222' }],
  ])('classifies exact %s duplicates as hard blocks', (kind, changes) => {
    const matches = classifyLeadDuplicates({ ...emptyLeadDetails(), company_name: 'Different', ...changes }, [lead()])
    expect(matches).toHaveLength(1)
    expect(matches[0].exactIdentifier).toBe(true)
    expect(matches[0].kinds).toContain(kind)
  })

  it('keeps company-only matches as warnings', () => {
    const matches = classifyLeadDuplicates({ ...emptyLeadDetails(), company_name: ' example studio ' }, [lead()])
    expect(matches).toEqual([{ lead: lead(), kinds: ['company'], exactIdentifier: false }])
  })

  it('reports only changed normalized fields', () => {
    const before = { ...emptyLeadDetails(), company_name: 'Example', email: 'hello@example.com' }
    const after = { ...before, company_name: ' Example ', email: 'new@example.com', website: 'example.com' }
    expect(changedLeadDetailFields(before, after)).toEqual(['email', 'website'])
  })
})

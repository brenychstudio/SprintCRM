import { describe, expect, it } from 'vitest'
import { buildResearchPrompt, evidenceMatchesSources, extractWebSearchSourceUrls, normalizeResearchUsage, parseResearchResult, validatePublicWebsite, validateResearchRequest } from './ai-research'

const memberId = '11111111-1111-4111-8111-111111111111'
const result = { observed_opportunity: 'The public services page describes a focused design practice but has no visible conversion path for the campaign offer, which is an observable opportunity.', recommended_offer: 'Offer the verified campaign service as a focused improvement to the public site journey and explain that a human will validate the fit before outreach.', recommended_case: null, evidence: [{ url: 'https://studio.test/services', note: 'The services page publicly lists the studio’s design services.' }], confidence: 0.7, warnings: ['No verified case context was provided.'] }

describe('supervised AI research helpers', () => {
  it('validates UUID research requests and rejects unrelated operations', () => {
    expect(validateResearchRequest({ operation: 'generate_research', campaign_member_id: memberId }).ok).toBe(true)
    expect(validateResearchRequest({ operation: 'generate_research', campaign_member_id: 'nope' }).ok).toBe(false)
    expect(validateResearchRequest({ operation: 'runtime_probe', campaign_member_id: memberId }).ok).toBe(false)
  })
  it('normalizes public websites and rejects localhost, private IPs, placeholders and credentials', () => {
    expect(validatePublicWebsite('https://www.Studio.test/path')).toEqual({ ok: true, hostname: 'studio.test' })
    for (const url of ['http://localhost:3000', 'https://127.0.0.1', 'https://10.0.0.2', 'https://[::1]', 'https://example.com', 'ftp://studio.test', 'https://user:pass@studio.test']) expect(validatePublicWebsite(url).ok).toBe(false)
  })
  it('keeps private contact fields out of the provider prompt', () => {
    const prompt = buildResearchPrompt({ hostname: 'studio.test', lead: { company_name: 'Studio', website: 'https://studio.test', website_domain: 'studio.test', niche: null, country_city: null, service_interest: null, offer_type: null, observed_issue: null, language: 'en' }, campaign: { name: 'Campaign', description: null, target_segment: null, offer_summary: 'Verified offer', default_language: 'en', tone: null, proof_context: null } })
    expect(prompt).not.toContain('email').not.toContain('phone').not.toContain('contact_name').not.toContain('notes')
  })
  it('parses strict results, permits nullable cases, and enforces proof context', () => {
    expect(parseResearchResult(JSON.stringify(result), null)).toEqual(result)
    expect(parseResearchResult({ ...result, recommended_case: 'Invented Case' }, null)).toBeNull()
    expect(parseResearchResult({ ...result, warnings: [] }, null)).toBeNull()
    expect(parseResearchResult({ ...result, confidence: 2 }, 'Verified case: A')).toBeNull()
  })
  it('extracts web search sources and rejects unrelated evidence domains', () => {
    const sources = extractWebSearchSourceUrls({ output: [{ type: 'message', content: [{ type: 'output_text', annotations: [{ type: 'url_citation', url: 'https://studio.test/services' }] }] }] })
    expect(sources).toContain('https://studio.test/services')
    expect(evidenceMatchesSources(result.evidence, sources, 'studio.test')).toBe(true)
    expect(evidenceMatchesSources([{ url: 'https://unrelated.test', note: 'Observable fact' }], sources, 'studio.test')).toBe(false)
  })
  it('normalizes provider usage without inventing token values', () => {
    expect(normalizeResearchUsage({ input_tokens: 3, input_tokens_details: { cached_tokens: 1 }, output_tokens: 4, total_tokens: 7 })).toEqual({ input_tokens: 3, cached_input_tokens: 1, output_tokens: 4, total_tokens: 7 })
    expect(normalizeResearchUsage({ input_tokens: -1 })).toEqual({ input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0 })
  })
})

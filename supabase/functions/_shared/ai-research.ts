import { isUuid, type NormalizedUsage, type RuntimeErrorCode } from './ai-runtime.ts'

export const researchSchemaVersion = 'research_v1'
export const researchPromptVersion = 'outreach_research_v1'

export type ResearchRequest = { operation: 'generate_research'; campaign_member_id: string; client_request_id?: string }
export type ResearchEvidence = { url: string; note: string }
export type ResearchResult = { observed_opportunity: string; recommended_offer: string; recommended_case: string | null; evidence: ResearchEvidence[]; confidence: number; warnings: string[] }
export type PublicResearchInput = {
  lead: { company_name: string | null; website: string; website_domain: string | null; niche: string | null; country_city: string | null; service_interest: string | null; offer_type: string | null; observed_issue: string | null; language: string | null }
  campaign: { name: string; description: string | null; target_segment: string | null; offer_summary: string | null; default_language: string; tone: string | null; proof_context: string | null }
  hostname: string
}
export type WebsiteValidation = { ok: true; hostname: string } | { ok: false; code: 'website_required' | 'invalid_website' }

const placeholderDomains = new Set(['example.com', 'example.org', 'example.net'])
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const nonNegative = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0

export function validateResearchRequest(value: unknown): { ok: true; value: ResearchRequest } | { ok: false } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false }
  const request = value as Record<string, unknown>
  if (request.operation !== 'generate_research' || !isUuid(request.campaign_member_id)) return { ok: false }
  if (request.client_request_id !== undefined && !isUuid(request.client_request_id)) return { ok: false }
  return { ok: true, value: { operation: 'generate_research', campaign_member_id: request.campaign_member_id, client_request_id: request.client_request_id as string | undefined } }
}

function privateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = octets
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))
}

function privateIpv6(hostname: string): boolean {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || /^::ffff:127\./.test(value)
}

export function validatePublicWebsite(value: unknown): WebsiteValidation {
  const source = text(value)
  if (!source) return { ok: false, code: 'website_required' }
  let url: URL
  try { url = new URL(source) } catch { return { ok: false, code: 'invalid_website' } }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || (url.port && !((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')))) return { ok: false, code: 'invalid_website' }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || placeholderDomains.has(hostname) || privateIpv4(hostname) || privateIpv6(hostname)) return { ok: false, code: 'invalid_website' }
  return { ok: true, hostname: hostname.replace(/^www\./, '') }
}

export function normalizedSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
    url.hash = ''
    return url.toString()
  } catch { return null }
}

function collectSourceUrls(value: unknown, urls: Set<string>, webSearchContext = false): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { value.forEach((item) => collectSourceUrls(item, urls, webSearchContext)); return }
  const record = value as Record<string, unknown>
  const isWebSearch = webSearchContext || record.type === 'web_search_call' || record.type === 'url_citation'
  if (isWebSearch) {
    const normalized = normalizedSourceUrl(record.url)
    if (normalized) urls.add(normalized)
  }
  for (const child of Object.values(record)) collectSourceUrls(child, urls, isWebSearch)
}

export function extractWebSearchSourceUrls(response: unknown): string[] {
  const urls = new Set<string>()
  collectSourceUrls(response, urls)
  return [...urls]
}

export function extractOutputText(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null
  const output = (response as { output?: unknown }).output
  if (!Array.isArray(output)) return null
  for (const item of output) {
    if (!item || typeof item !== 'object' || !Array.isArray((item as { content?: unknown }).content)) continue
    for (const part of (item as { content: unknown[] }).content) {
      if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'output_text' && typeof (part as { text?: unknown }).text === 'string') return (part as { text: string }).text
    }
  }
  return null
}

function validText(value: unknown, min: number, max: number): value is string { return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max }

export function parseResearchResult(value: unknown, proofContext: string | null | undefined): ResearchResult | null {
  let parsed = value
  if (typeof value === 'string') { try { parsed = JSON.parse(value) } catch { return null } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const result = parsed as Record<string, unknown>
  if (Object.keys(result).length !== 6 || !validText(result.observed_opportunity, 50, 900) || !validText(result.recommended_offer, 30, 700) || typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1 || !Array.isArray(result.evidence) || result.evidence.length < 1 || result.evidence.length > 5 || !Array.isArray(result.warnings) || result.warnings.length > 5) return null
  const hasProof = Boolean(text(proofContext))
  if (result.recommended_case !== null && !validText(result.recommended_case, 1, 700)) return null
  if (!hasProof && result.recommended_case !== null) return null
  const warnings = result.warnings.map((warning) => text(warning))
  if (warnings.some((warning) => !warning || warning.length > 300)) return null
  if (!hasProof && !warnings.some((warning) => /no verified (case|proof) context|no verified (case|proof).*(provided|available)/i.test(warning))) return null
  const evidence: ResearchEvidence[] = []
  for (const item of result.evidence) {
    if (!item || typeof item !== 'object' || !validText((item as Record<string, unknown>).url, 8, 2000) || !validText((item as Record<string, unknown>).note, 5, 900)) return null
    evidence.push({ url: (item as { url: string }).url.trim(), note: (item as { note: string }).note.trim() })
  }
  return { observed_opportunity: result.observed_opportunity.trim(), recommended_offer: result.recommended_offer.trim(), recommended_case: result.recommended_case === null ? null : result.recommended_case.trim(), evidence, confidence: result.confidence, warnings }
}

export function evidenceMatchesSources(evidence: ResearchEvidence[], sourceUrls: string[], hostname: string): boolean {
  const sources = new Set(sourceUrls.map(normalizedSourceUrl).filter((value): value is string => Boolean(value)))
  return evidence.length > 0 && evidence.every((item) => {
    const url = normalizedSourceUrl(item.url)
    if (!url) return false
    const evidenceHost = new URL(url).hostname.replace(/^www\./, '')
    if (evidenceHost === hostname || evidenceHost.endsWith('.' + hostname)) return true
    return sources.has(url)
  })
}

export function researchJsonSchema() {
  return { type: 'object', additionalProperties: false, properties: {
    observed_opportunity: { type: 'string', minLength: 50, maxLength: 900 },
    recommended_offer: { type: 'string', minLength: 30, maxLength: 700 },
    recommended_case: { anyOf: [{ type: 'string', minLength: 1, maxLength: 700 }, { type: 'null' }] },
    evidence: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string' }, note: { type: 'string', minLength: 5, maxLength: 900 } }, required: ['url', 'note'] } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    warnings: { type: 'array', maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 300 } },
  }, required: ['observed_opportunity', 'recommended_offer', 'recommended_case', 'evidence', 'confidence', 'warnings'] }
}

export function buildResearchPrompt(input: PublicResearchInput): string {
  const proof = text(input.campaign.proof_context)
  return JSON.stringify({
    instructions: 'Research only the public website domain supplied below. Identify visible positioning, services, client-facing communication, and opportunities relevant to the verified campaign offer. Do not infer revenue, budgets, employees, private clients, decision makers, internal problems, performance, dissatisfaction, technology, awards, or outcomes. Cite observable public facts only. Do not write outreach. If verified proof context is empty, recommended_case must be null and warnings must include "No verified case context was provided."',
    lead: input.lead,
    campaign: { ...input.campaign, proof_context: proof || null },
    allowed_domain: input.hostname,
  })
}

export function normalizeResearchUsage(value: unknown): NormalizedUsage {
  const usage = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const inputDetails = usage.input_tokens_details && typeof usage.input_tokens_details === 'object' && !Array.isArray(usage.input_tokens_details) ? usage.input_tokens_details as Record<string, unknown> : {}
  const input_tokens = nonNegative(usage.input_tokens)
  const output_tokens = nonNegative(usage.output_tokens)
  return { input_tokens, cached_input_tokens: nonNegative(inputDetails.cached_tokens), output_tokens, total_tokens: nonNegative(usage.total_tokens) || input_tokens + output_tokens }
}

export function mapResearchProviderError(status?: number, timedOut = false): RuntimeErrorCode | 'invalid_evidence' | 'research_disabled' | 'website_required' | 'invalid_website' {
  if (timedOut) return 'provider_timeout'
  if (status === 429) return 'provider_rate_limited'
  if (status === 401 || status === 403) return 'configuration_missing'
  return 'provider_error'
}

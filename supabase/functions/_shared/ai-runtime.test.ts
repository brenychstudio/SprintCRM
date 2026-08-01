import { describe, expect, it } from 'vitest'
import { corsHeaders, isAllowedOrigin, isUuid, mapProviderError, normalizeResponsesUsage, parseRuntimeProbeResult, validateRuntimeProbeRequest } from './ai-runtime'

const memberId = '11111111-1111-4111-8111-111111111111'

describe('AI runtime pure contract', () => {
  it('validates only the synthetic runtime probe request and UUIDs', () => {
    expect(isUuid(memberId)).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(validateRuntimeProbeRequest({ operation: 'runtime_probe', campaign_member_id: memberId })).toMatchObject({ ok: true })
    expect(validateRuntimeProbeRequest({ operation: 'research', campaign_member_id: memberId })).toEqual({ ok: false })
    expect(validateRuntimeProbeRequest({ operation: 'runtime_probe', campaign_member_id: 'bad' })).toEqual({ ok: false })
  })

  it('accepts only the strict probe payload', () => {
    expect(parseRuntimeProbeResult('{"status":"ok","contract_version":"runtime_probe_v1"}')).toEqual({ status: 'ok', contract_version: 'runtime_probe_v1' })
    expect(parseRuntimeProbeResult({ status: 'ok', contract_version: 'runtime_probe_v1', extra: true })).toBeNull()
    expect(parseRuntimeProbeResult('{"status":"no"}')).toBeNull()
  })

  it('normalizes Responses API usage without inventing values', () => {
    expect(normalizeResponsesUsage({ input_tokens: 4, input_tokens_details: { cached_tokens: 2 }, output_tokens: 3, total_tokens: 7 })).toEqual({ input_tokens: 4, cached_input_tokens: 2, output_tokens: 3, total_tokens: 7 })
    expect(normalizeResponsesUsage(null)).toEqual({ input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0 })
  })

  it('maps provider errors safely', () => {
    expect(mapProviderError(429)).toBe('provider_rate_limited')
    expect(mapProviderError(undefined, true)).toBe('provider_timeout')
    expect(mapProviderError(500)).toBe('provider_error')
  })

  it('allows only explicit origins and never creates wildcard CORS', () => {
    const allowed = 'http://localhost:5173,https://crm.example.com'
    expect(isAllowedOrigin('http://localhost:5173', allowed)).toBe(true)
    expect(isAllowedOrigin('https://evil.example.com', allowed)).toBe(false)
    expect(corsHeaders('https://evil.example.com', allowed)).not.toHaveProperty('Access-Control-Allow-Origin')
  })
})

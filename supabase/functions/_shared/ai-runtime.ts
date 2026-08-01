export const runtimeProbeSchemaVersion = 'runtime_probe_v1'

export type RuntimeProbeRequest = {
  operation: 'runtime_probe'
  campaign_member_id: string
  client_request_id?: string
}

export type RuntimeProbeResult = {
  status: 'ok'
  contract_version: typeof runtimeProbeSchemaVersion
}

export type NormalizedUsage = {
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  total_tokens: number
}

export type RuntimeErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'unavailable'
  | 'runtime_disabled'
  | 'research_disabled'
  | 'draft_disabled'
  | 'research_required'
  | 'stale_research'
  | 'invalid_member_state'
  | 'configuration_missing'
  | 'website_required'
  | 'invalid_website'
  | 'provider_rate_limited'
  | 'provider_timeout'
  | 'provider_error'
  | 'invalid_provider_response'
  | 'invalid_evidence'
  | 'persistence_error'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

export function validateRuntimeProbeRequest(value: unknown): { ok: true; value: RuntimeProbeRequest } | { ok: false } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false }
  const request = value as Record<string, unknown>
  if (request.operation !== 'runtime_probe' || !isUuid(request.campaign_member_id)) return { ok: false }
  if (request.client_request_id !== undefined && !isUuid(request.client_request_id)) return { ok: false }
  return { ok: true, value: { operation: 'runtime_probe', campaign_member_id: request.campaign_member_id, client_request_id: request.client_request_id as string | undefined } }
}

export function parseRuntimeProbeResult(value: unknown): RuntimeProbeResult | null {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { return null }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const result = parsed as Record<string, unknown>
  if (Object.keys(result).length !== 2 || result.status !== 'ok' || result.contract_version !== runtimeProbeSchemaVersion) return null
  return { status: 'ok', contract_version: runtimeProbeSchemaVersion }
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

export function normalizeResponsesUsage(value: unknown): NormalizedUsage {
  const usage = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const inputDetails = usage.input_tokens_details && typeof usage.input_tokens_details === 'object' && !Array.isArray(usage.input_tokens_details)
    ? usage.input_tokens_details as Record<string, unknown> : {}
  const input_tokens = nonNegativeInt(usage.input_tokens)
  const output_tokens = nonNegativeInt(usage.output_tokens)
  const total_tokens = nonNegativeInt(usage.total_tokens) || input_tokens + output_tokens
  return {
    input_tokens,
    cached_input_tokens: nonNegativeInt(inputDetails.cached_tokens),
    output_tokens,
    total_tokens,
  }
}

export function isAllowedOrigin(origin: string | null, allowedOrigins: string): boolean {
  if (!origin || !allowedOrigins.trim()) return false
  try {
    const normalized = new URL(origin).origin
    return allowedOrigins.split(',').map((item) => item.trim()).filter(Boolean).some((item) => {
      try { return new URL(item).origin === normalized } catch { return false }
    })
  } catch { return false }
}

export function corsHeaders(origin: string | null, allowedOrigins: string): HeadersInit {
  if (!isAllowedOrigin(origin, allowedOrigins) || !origin) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

export function mapProviderError(status: number | undefined, timedOut = false): RuntimeErrorCode {
  if (timedOut) return 'provider_timeout'
  if (status === 429) return 'provider_rate_limited'
  if (status === 401 || status === 403) return 'configuration_missing'
  return 'provider_error'
}

export function safeErrorMessage(code: RuntimeErrorCode): string {
  const messages: Record<RuntimeErrorCode, string> = {
    invalid_request: 'The request is invalid.',
    unauthorized: 'You are not authorized to test this AI connection.',
    unavailable: 'The AI connection is currently unavailable.',
    runtime_disabled: 'AI runtime is disabled.',
    research_disabled: 'AI research is disabled.',
    draft_disabled: 'AI draft generation is disabled.',
    research_required: 'Research is required before generating a draft.',
    stale_research: 'The confirmed research is no longer current.',
    invalid_member_state: 'This workflow state does not allow AI draft generation.',
    configuration_missing: 'AI runtime configuration is incomplete.',
    website_required: 'A public company website is required for AI research.',
    invalid_website: 'The company website is not safe for AI research.',
    provider_rate_limited: 'The AI provider is temporarily rate limited.',
    provider_timeout: 'The AI provider did not respond in time.',
    provider_error: 'The AI provider could not complete the probe.',
    invalid_provider_response: 'The AI provider returned an invalid probe result.',
    invalid_evidence: 'The AI provider returned evidence outside the allowed public website.',
    persistence_error: 'The AI probe result could not be recorded.',
  }
  return messages[code]
}

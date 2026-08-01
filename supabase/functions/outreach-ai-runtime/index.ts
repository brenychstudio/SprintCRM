import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  corsHeaders,
  isAllowedOrigin,
  mapProviderError,
  normalizeResponsesUsage,
  parseRuntimeProbeResult,
  runtimeProbeSchemaVersion,
  safeErrorMessage,
  validateRuntimeProbeRequest,
  type NormalizedUsage,
  type RuntimeErrorCode,
} from '../_shared/ai-runtime.ts'

type ProbeLedgerRow = {
  job_id: string
  generation_status: string
  model_name: string | null
  schema_version: string | null
  input_tokens: number | null
  cached_input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  estimated_cost_usd: number | null
  duration_ms: number | null
  request_id: string | null
  was_created: boolean
}

const jsonHeaders = { 'Content-Type': 'application/json' }

function errorStatus(code: RuntimeErrorCode): number {
  if (code === 'invalid_request') return 400
  if (code === 'unauthorized') return 401
  if (code === 'runtime_disabled' || code === 'configuration_missing') return 503
  if (code === 'provider_rate_limited') return 429
  if (code === 'unavailable') return 409
  return 502
}

function errorResponse(code: RuntimeErrorCode, requestId: string, cors: HeadersInit, status = errorStatus(code)) {
  return new Response(JSON.stringify({ ok: false, code, message: safeErrorMessage(code), request_id: requestId, retryable: false }), {
    status, headers: { ...cors, ...jsonHeaders },
  })
}

function usageFromLedger(row: ProbeLedgerRow): NormalizedUsage {
  return {
    input_tokens: row.input_tokens ?? 0,
    cached_input_tokens: row.cached_input_tokens ?? 0,
    output_tokens: row.output_tokens ?? 0,
    total_tokens: row.total_tokens ?? 0,
  }
}

function completedResponse(row: ProbeLedgerRow, cors: HeadersInit) {
  return new Response(JSON.stringify({
    ok: true,
    job_id: row.job_id,
    status: 'completed',
    provider: 'openai',
    model: row.model_name ?? '',
    schema_version: row.schema_version ?? runtimeProbeSchemaVersion,
    usage: usageFromLedger(row),
    cost: { estimated_usd: row.estimated_cost_usd, status: 'not_configured' },
    duration_ms: row.duration_ms ?? 0,
  }), { status: 200, headers: { ...cors, ...jsonHeaders } })
}

function rpcRow(data: unknown): ProbeLedgerRow | null {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  return typeof value.job_id === 'string' && typeof value.generation_status === 'string'
    ? value as ProbeLedgerRow : null
}

function outputText(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null
  const output = (response as { output?: unknown }).output
  if (!Array.isArray(output)) return null
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'output_text' && typeof (part as { text?: unknown }).text === 'string') {
        return (part as { text: string }).text
      }
    }
  }
  return null
}

async function finishFailure(
  service: ReturnType<typeof createClient>, row: ProbeLedgerRow, userId: string, code: RuntimeErrorCode, durationMs: number,
  providerResponseId: string | null = null, providerRequestId: string | null = null,
) {
  const { error } = await service.rpc('finish_ai_runtime_probe', {
    p_job_id: row.job_id, p_actor_user_id: userId, p_status: 'failed',
    p_provider_response_id: providerResponseId, p_provider_request_id: providerRequestId, p_output_payload: null,
    p_input_tokens: null, p_cached_input_tokens: null, p_output_tokens: null, p_total_tokens: null,
    p_duration_ms: durationMs, p_error_code: code, p_error_message: safeErrorMessage(code),
  })
  return !error
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')
  const allowedOrigins = Deno.env.get('AI_ALLOWED_ORIGINS') ?? ''
  const cors = corsHeaders(origin, allowedOrigins)
  const requestId = crypto.randomUUID()

  if (request.method === 'OPTIONS') {
    return isAllowedOrigin(origin, allowedOrigins)
      ? new Response(null, { status: 204, headers: cors })
      : errorResponse('unauthorized', requestId, cors, 403)
  }
  if (!isAllowedOrigin(origin, allowedOrigins)) return errorResponse('unauthorized', requestId, cors, 403)
  if (request.method !== 'POST') return errorResponse('invalid_request', requestId, cors, 405)

  let body: unknown
  try { body = await request.json() } catch { return errorResponse('invalid_request', requestId, cors) }
  const validated = validateRuntimeProbeRequest(body)
  if (!validated.ok) return errorResponse('invalid_request', requestId, cors)
  const clientRequestId = validated.value.client_request_id ?? requestId

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('authorization')
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) return errorResponse('unauthorized', clientRequestId, cors)

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return errorResponse('unauthorized', clientRequestId, cors)
  const userId = authData.user.id
  const { data: member, error: memberError } = await userClient
    .from('campaign_members').select('id').eq('id', validated.value.campaign_member_id).maybeSingle()
  if (memberError || !member) return errorResponse('unauthorized', clientRequestId, cors, 404)

  if ((Deno.env.get('AI_RUNTIME_ENABLED') ?? 'false').trim().toLowerCase() !== 'true') return errorResponse('runtime_disabled', clientRequestId, cors)
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  const model = Deno.env.get('OPENAI_MODEL')?.trim()
  if (!apiKey || !model) return errorResponse('configuration_missing', clientRequestId, cors)

  const service = createClient(supabaseUrl, serviceRoleKey)
  const { data: started, error: startError } = await service.rpc('start_ai_runtime_probe', {
    p_campaign_member_id: validated.value.campaign_member_id,
    p_actor_user_id: userId,
    p_request_id: clientRequestId,
    p_model: model,
  })
  const row = rpcRow(started)
  if (startError || !row) return errorResponse('persistence_error', clientRequestId, cors)
  if (!row.was_created) {
    if (row.generation_status === 'completed') return completedResponse(row, cors)
    return errorResponse(row.generation_status === 'failed' ? 'provider_error' : 'unavailable', clientRequestId, cors)
  }

  const startedAt = Date.now()
  let providerResponseId: string | null = null
  let providerRequestId: string | null = null
  try {
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), 25_000)
    let provider: Response
    try {
      provider = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', signal: abort.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': clientRequestId },
        body: JSON.stringify({
          model, store: false, max_output_tokens: 32,
          input: 'Return the runtime probe contract exactly. This is synthetic test data only.',
          text: { format: { type: 'json_schema', name: 'runtime_probe', strict: true, schema: {
            type: 'object', additionalProperties: false,
            properties: { status: { type: 'string', const: 'ok' }, contract_version: { type: 'string', const: runtimeProbeSchemaVersion } },
            required: ['status', 'contract_version'],
          } } },
        }),
      })
    } finally { clearTimeout(timeout) }
    providerRequestId = provider.headers.get('x-request-id')
    if (!provider.ok) {
      const code = mapProviderError(provider.status)
      const persisted = await finishFailure(service, row, userId, code, Date.now() - startedAt, providerResponseId, providerRequestId)
      return errorResponse(persisted ? code : 'persistence_error', clientRequestId, cors)
    }
    const providerBody: unknown = await provider.json()
    providerResponseId = providerBody && typeof providerBody === 'object' && typeof (providerBody as { id?: unknown }).id === 'string' ? (providerBody as { id: string }).id : null
    const probe = parseRuntimeProbeResult(outputText(providerBody))
    if (!probe) {
      const persisted = await finishFailure(service, row, userId, 'invalid_provider_response', Date.now() - startedAt, providerResponseId, providerRequestId)
      return errorResponse(persisted ? 'invalid_provider_response' : 'persistence_error', clientRequestId, cors)
    }
    const usage = normalizeResponsesUsage(providerBody && typeof providerBody === 'object' ? (providerBody as { usage?: unknown }).usage : null)
    const durationMs = Date.now() - startedAt
    const { data: finished, error: finishError } = await service.rpc('finish_ai_runtime_probe', {
      p_job_id: row.job_id, p_actor_user_id: userId, p_status: 'completed',
      p_provider_response_id: providerResponseId, p_provider_request_id: providerRequestId,
      p_output_payload: probe, p_input_tokens: usage.input_tokens, p_cached_input_tokens: usage.cached_input_tokens,
      p_output_tokens: usage.output_tokens, p_total_tokens: usage.total_tokens, p_duration_ms: durationMs,
      p_error_code: null, p_error_message: null,
    })
    if (finishError) return errorResponse('persistence_error', clientRequestId, cors)
    const finishedRow = rpcRow(finished)
    return finishedRow ? completedResponse(finishedRow, cors) : new Response(JSON.stringify({
      ok: true, job_id: row.job_id, status: 'completed', provider: 'openai', model,
      schema_version: runtimeProbeSchemaVersion, usage, cost: { estimated_usd: null, status: 'not_configured' }, duration_ms: durationMs,
    }), { status: 200, headers: { ...cors, ...jsonHeaders } })
  } catch (error) {
    const code = mapProviderError(undefined, error instanceof DOMException && error.name === 'AbortError')
    const persisted = await finishFailure(service, row, userId, code, Date.now() - startedAt)
    return errorResponse(persisted ? code : 'persistence_error', clientRequestId, cors)
  }
})

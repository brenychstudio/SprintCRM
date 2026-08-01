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
import {
  buildRejectedResearchFailure,
  buildResearchResponsesRequest,
  evidenceMatchesSources,
  extractOutputText,
  extractWebSearchSourceUrls,
  mapResearchProviderError,
  normalizeResearchUsage,
  parseResearchResultDetailed,
  researchPromptVersion,
  researchSchemaVersion,
  resolveResearchLanguage,
  safeResearchErrorMessage,
  validatePublicWebsite,
  validateResearchRequest,
} from '../_shared/ai-research.ts'

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

function researchErrorResponse(code: RuntimeErrorCode, requestId: string, cors: HeadersInit, status = errorStatus(code)) {
  return new Response(JSON.stringify({ ok: false, code, message: safeResearchErrorMessage(code), request_id: requestId, retryable: false }), {
    status, headers: { ...cors, ...jsonHeaders },
  })
}

type ResearchLedgerRow = ProbeLedgerRow & { research_snapshot_id?: string | null; research_version?: number | null }

function researchRow(data: unknown): ResearchLedgerRow | null {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  return typeof value.job_id === 'string' && typeof value.generation_status === 'string' ? value as ResearchLedgerRow : null
}

function researchCompletedResponse(row: ResearchLedgerRow, snapshotId: string, version: number, sourceCount: number, cors: HeadersInit) {
  return new Response(JSON.stringify({
    ok: true, job_id: row.job_id, research_snapshot_id: snapshotId, research_version: version,
    status: 'completed', provider: 'openai', model: row.model_name ?? '', schema_version: row.schema_version ?? researchSchemaVersion,
    usage: usageFromLedger(row), cost: { estimated_usd: null, status: 'not_configured' }, duration_ms: row.duration_ms ?? 0, source_count: sourceCount,
  }), { status: 200, headers: { ...cors, ...jsonHeaders } })
}

async function finishResearchFailure(
  service: ReturnType<typeof createClient>, row: ResearchLedgerRow, userId: string, code: RuntimeErrorCode, durationMs: number,
  providerResponseId: string | null = null, providerRequestId: string | null = null, usage: NormalizedUsage | null = null,
  errorMessage = safeResearchErrorMessage(code),
) {
  const { error } = await service.rpc('finish_ai_research_job', {
    p_job_id: row.job_id, p_actor_user_id: userId, p_status: 'failed', p_provider_response_id: providerResponseId,
    p_provider_request_id: providerRequestId, p_output_payload: null, p_input_tokens: usage?.input_tokens ?? null, p_cached_input_tokens: usage?.cached_input_tokens ?? null,
    p_output_tokens: usage?.output_tokens ?? null, p_total_tokens: usage?.total_tokens ?? null, p_duration_ms: durationMs, p_error_code: code, p_error_message: errorMessage,
  })
  return !error
}

function enabled(name: string): boolean { return (Deno.env.get(name) ?? 'false').trim().toLowerCase() === 'true' }

async function generateResearch(request: Request, body: unknown, requestId: string, cors: HeadersInit): Promise<Response> {
  const validated = validateResearchRequest(body)
  if (!validated.ok) return researchErrorResponse('invalid_request', requestId, cors)
  const clientRequestId = validated.value.client_request_id ?? requestId
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('authorization')
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) return researchErrorResponse('unauthorized', clientRequestId, cors)
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return researchErrorResponse('unauthorized', clientRequestId, cors)
  const userId = authData.user.id
  const { data: member, error: memberError } = await userClient.from('campaign_members').select('id,campaign_id,lead_id').eq('id', validated.value.campaign_member_id).maybeSingle()
  if (memberError || !member) return researchErrorResponse('unauthorized', clientRequestId, cors, 404)
  const [campaignResponse, leadResponse] = await Promise.all([
    userClient.from('campaigns').select('name,description,target_segment,offer_summary,default_language,tone,proof_context').eq('id', member.campaign_id).maybeSingle(),
    userClient.from('leads').select('company_name,website,website_domain,niche,country_city,service_interest,offer_type,observed_issue,language').eq('id', member.lead_id).maybeSingle(),
  ])
  if (campaignResponse.error || leadResponse.error || !campaignResponse.data || !leadResponse.data) return researchErrorResponse('unauthorized', clientRequestId, cors, 404)
  const website = validatePublicWebsite(leadResponse.data.website)
  if (!website.ok) return researchErrorResponse(website.code, clientRequestId, cors)
  if (!enabled('AI_RUNTIME_ENABLED')) return researchErrorResponse('runtime_disabled', clientRequestId, cors)
  if (!enabled('AI_RESEARCH_ENABLED')) return researchErrorResponse('research_disabled', clientRequestId, cors)
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  const model = Deno.env.get('OPENAI_MODEL')?.trim()
  if (!apiKey || !model) return researchErrorResponse('configuration_missing', clientRequestId, cors)
  const service = createClient(supabaseUrl, serviceRoleKey)
  const { data: started, error: startError } = await service.rpc('start_ai_research_job', {
    p_campaign_member_id: member.id, p_actor_user_id: userId, p_request_id: clientRequestId, p_model: model, p_prompt_version: researchPromptVersion,
  })
  const row = researchRow(started)
  if (startError || !row) return researchErrorResponse('persistence_error', clientRequestId, cors)
  if (!row.was_created) {
    if (row.generation_status === 'completed') {
      const { data: snapshot, error: snapshotError } = await userClient.from('research_snapshots').select('id,version,evidence').eq('ai_generation_id', row.job_id).maybeSingle()
      if (snapshotError || !snapshot) return researchErrorResponse('persistence_error', clientRequestId, cors)
      return researchCompletedResponse(row, snapshot.id, snapshot.version, Array.isArray(snapshot.evidence) ? snapshot.evidence.length : 0, cors)
    }
    return researchErrorResponse(row.generation_status === 'failed' ? 'provider_error' : 'unavailable', clientRequestId, cors)
  }
  const startedAt = Date.now()
  let providerResponseId: string | null = null
  let providerRequestId: string | null = null
  try {
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), 45_000)
    let provider: Response
    try {
      provider = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', signal: abort.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': clientRequestId },
        body: JSON.stringify({
          ...buildResearchResponsesRequest(model, { lead: leadResponse.data, campaign: campaignResponse.data, hostname: website.hostname }),
        }),
      })
    } finally { clearTimeout(timeout) }
    providerRequestId = provider.headers.get('x-request-id')
    if (!provider.ok) {
      const code = mapResearchProviderError(provider.status)
      const persisted = await finishResearchFailure(service, row, userId, code, Date.now() - startedAt, providerResponseId, providerRequestId)
      return researchErrorResponse(persisted ? code : 'persistence_error', clientRequestId, cors)
    }
    const providerBody: unknown = await provider.json()
    providerResponseId = providerBody && typeof providerBody === 'object' && typeof (providerBody as { id?: unknown }).id === 'string' ? (providerBody as { id: string }).id : null
    const usage = normalizeResearchUsage(providerBody && typeof providerBody === 'object' ? (providerBody as { usage?: unknown }).usage : null)
    const parsed = parseResearchResultDetailed(extractOutputText(providerBody), campaignResponse.data.proof_context, resolveResearchLanguage(leadResponse.data.language, campaignResponse.data.default_language))
    if (!parsed.ok) {
      const rejected = buildRejectedResearchFailure(parsed.reason, usage, providerResponseId, providerRequestId)
      const persisted = await finishResearchFailure(service, row, userId, rejected.error_code, Date.now() - startedAt, rejected.provider_response_id, rejected.provider_request_id, {
        input_tokens: rejected.input_tokens, cached_input_tokens: rejected.cached_input_tokens, output_tokens: rejected.output_tokens, total_tokens: rejected.total_tokens,
      }, rejected.error_message)
      return researchErrorResponse(persisted ? 'invalid_provider_response' : 'persistence_error', clientRequestId, cors)
    }
    const result = parsed.value
    const sources = extractWebSearchSourceUrls(providerBody)
    if (!evidenceMatchesSources(result.evidence, sources, website.hostname)) {
      const persisted = await finishResearchFailure(service, row, userId, 'invalid_evidence', Date.now() - startedAt, providerResponseId, providerRequestId)
      return researchErrorResponse(persisted ? 'invalid_evidence' : 'persistence_error', clientRequestId, cors)
    }
    const durationMs = Date.now() - startedAt
    const { data: finished, error: finishError } = await service.rpc('finish_ai_research_job', {
      p_job_id: row.job_id, p_actor_user_id: userId, p_status: 'completed', p_provider_response_id: providerResponseId, p_provider_request_id: providerRequestId,
      p_output_payload: result, p_input_tokens: usage.input_tokens, p_cached_input_tokens: usage.cached_input_tokens, p_output_tokens: usage.output_tokens,
      p_total_tokens: usage.total_tokens, p_duration_ms: durationMs, p_error_code: null, p_error_message: null,
    })
    const finishedRow = researchRow(finished)
    if (finishError || !finishedRow || !finishedRow.research_snapshot_id || typeof finishedRow.research_version !== 'number') return researchErrorResponse('persistence_error', clientRequestId, cors)
    return researchCompletedResponse(finishedRow, finishedRow.research_snapshot_id, finishedRow.research_version, result.evidence.length, cors)
  } catch (error) {
    const code = mapResearchProviderError(undefined, error instanceof DOMException && error.name === 'AbortError')
    const persisted = await finishResearchFailure(service, row, userId, code, Date.now() - startedAt, providerResponseId, providerRequestId)
    return researchErrorResponse(persisted ? code : 'persistence_error', clientRequestId, cors)
  }
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
  if (body && typeof body === 'object' && !Array.isArray(body) && (body as { operation?: unknown }).operation === 'generate_research') {
    return generateResearch(request, body, requestId, cors)
  }
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

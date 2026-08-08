import { FunctionsHttpError } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke } } }))

import { AiDraftGenerationError, generateAiDraft } from './campaignsApi'

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

afterEach(() => vi.clearAllMocks())

describe('generateAiDraft', () => {
  it('preserves the safe Edge Function failure envelope from FunctionsHttpError context', async () => {
    const response = new Response(JSON.stringify({ ok: false, code: 'provider_timeout', message: 'The AI provider timed out.', request_id: requestId, retryable: false }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(response), response })

    await expect(generateAiDraft('member', 'research', requestId)).rejects.toMatchObject({
      name: 'AiDraftGenerationError', code: 'provider_timeout', message: 'The AI provider timed out.', requestId, retryable: false,
    })
  })

  it('uses a safe request_failed error with the local ID when no structured response is available', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('network details must not reach UI') })

    await expect(generateAiDraft('member', 'research', requestId)).rejects.toEqual(expect.objectContaining({
      name: 'AiDraftGenerationError', code: 'request_failed', message: 'AI draft could not be generated.', requestId, retryable: false,
    }))
  })

  it('does not accept an internal validator detail as a displayable public code', async () => {
    const response = new Response(JSON.stringify({ ok: false, code: 'draft_validation:body_missing_low_pressure_cta', message: 'internal detail', request_id: requestId, retryable: false }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(response) })

    await expect(generateAiDraft('member', 'research', requestId)).rejects.toEqual(expect.objectContaining({ code: 'request_failed', requestId }))
  })

  it('does not retry the Edge Function invocation', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('network') })
    await expect(generateAiDraft('member', 'research', requestId)).rejects.toBeInstanceOf(AiDraftGenerationError)
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})

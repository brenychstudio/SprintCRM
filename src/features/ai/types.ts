import type { OutreachChannel, OutreachLanguage, OutreachVariant } from '../leads/types'

export type AiGenerationType = 'outreach'
export type AiGenerationStatus = 'pending' | 'completed' | 'failed'

export type AiGeneration = {
  id: string
  org_id: string
  owner: string
  created_by: string
  lead_id: string

  type: AiGenerationType
  channel: OutreachChannel
  variant: OutreachVariant
  language: OutreachLanguage

  input_snapshot: Record<string, unknown>

  subject: string | null
  body: string | null
  personalization_notes: string | null

  model_name: string | null
  prompt_version: string
  estimated_tokens: number | null

  generation_status: AiGenerationStatus
  error_message: string | null

  applied_to_lead: boolean
  applied_at: string | null

  created_at: string
}

export type CreateAiGenerationInput = {
  lead_id: string
  type?: AiGenerationType
  channel: OutreachChannel
  variant: OutreachVariant
  language: OutreachLanguage
  input_snapshot: Record<string, unknown>
  subject?: string | null
  body?: string | null
  personalization_notes?: string | null
  model_name?: string | null
  prompt_version?: string
  estimated_tokens?: number | null
  generation_status?: AiGenerationStatus
  error_message?: string | null
}

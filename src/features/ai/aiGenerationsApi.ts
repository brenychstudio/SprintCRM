import { supabase } from '../../lib/supabase'
import type { AiGeneration, CreateAiGenerationInput } from './types'

export const aiGenerationQueryKeys = {
  all: ['ai-generations'] as const,
  byLead: (leadId: string) => ['ai-generations', leadId] as const,
}

export async function listAiGenerationsForLead(leadId: string): Promise<AiGeneration[]> {
  const { data, error } = await supabase
    .from('ai_generations')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as AiGeneration[]
}

export async function createAiGeneration(input: CreateAiGenerationInput): Promise<AiGeneration> {
  const { data, error } = await supabase
    .from('ai_generations')
    .insert({
      lead_id: input.lead_id,
      type: input.type ?? 'outreach',
      channel: input.channel,
      variant: input.variant,
      language: input.language,
      input_snapshot: input.input_snapshot,
      subject: input.subject ?? null,
      body: input.body ?? null,
      personalization_notes: input.personalization_notes ?? null,
      model_name: input.model_name ?? null,
      prompt_version: input.prompt_version ?? 'outreach_v1',
      estimated_tokens: input.estimated_tokens ?? null,
      generation_status: input.generation_status ?? 'completed',
      error_message: input.error_message ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as AiGeneration
}

export async function markAiGenerationApplied(id: string): Promise<AiGeneration> {
  const { data, error } = await supabase
    .from('ai_generations')
    .update({
      applied_to_lead: true,
      applied_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return data as AiGeneration
}

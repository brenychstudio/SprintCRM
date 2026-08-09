export const featureFlagKeys = [
  'outreach_ops_enabled',
  'ai_draft_generation_enabled',
  'ai_runtime_enabled',
  'ai_research_enabled',
  'gmail_connection_enabled',
  'controlled_send_enabled',
] as const

export type FeatureFlagKey = (typeof featureFlagKeys)[number]
export type FeatureFlags = Record<FeatureFlagKey, boolean>
export type FeatureFlagSource = Partial<Record<FeatureFlagKey, string | boolean | undefined>>

export function readFeatureFlag(value: string | boolean | undefined): boolean {
  if (value === true) return true
  if (typeof value !== 'string') return false

  return ['1', 'true', 'on'].includes(value.trim().toLowerCase())
}

export function resolveFeatureFlags(source: FeatureFlagSource = {}): FeatureFlags {
  return Object.fromEntries(featureFlagKeys.map((key) => [key, readFeatureFlag(source[key])])) as FeatureFlags
}

export function isAiDraftGenerationVisible(flags: FeatureFlags): boolean {
  return flags.outreach_ops_enabled && flags.ai_runtime_enabled && flags.ai_draft_generation_enabled
}

function readViteFeatureFlag(key: FeatureFlagKey): string | boolean | undefined {
  const environmentKey = `VITE_${key.toUpperCase()}`
  return import.meta.env[environmentKey]
}

/**
 * Client-side exposure controls only UI availability. Any future server action
 * must enforce the same safety policy independently.
 */
export const featureFlags = resolveFeatureFlags(
  Object.fromEntries(featureFlagKeys.map((key) => [key, readViteFeatureFlag(key)])) as FeatureFlagSource,
)

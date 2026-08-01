import { describe, expect, it } from 'vitest'
import { readFeatureFlag, resolveFeatureFlags } from './featureFlags'

describe('feature flags', () => {
  it('defaults every flag to disabled', () => {
    expect(resolveFeatureFlags()).toEqual({
      outreach_ops_enabled: false,
      ai_draft_generation_enabled: false,
      ai_runtime_enabled: false,
      ai_research_enabled: false,
      gmail_connection_enabled: false,
      controlled_send_enabled: false,
    })
  })

  it('enables only explicit truthy values', () => {
    expect(readFeatureFlag('true')).toBe(true)
    expect(readFeatureFlag(' ON ')).toBe(true)
    expect(readFeatureFlag('1')).toBe(true)
    expect(readFeatureFlag('yes')).toBe(false)
    expect(readFeatureFlag(undefined)).toBe(false)
  })

  it('resolves the separate AI runtime flag independently of draft generation', () => {
    expect(resolveFeatureFlags({ ai_runtime_enabled: 'true', ai_draft_generation_enabled: false })).toMatchObject({
      ai_runtime_enabled: true,
      ai_draft_generation_enabled: false,
    })
  })

  it('keeps AI research separately default-off from the runtime boundary', () => {
    expect(resolveFeatureFlags({ ai_runtime_enabled: true, ai_research_enabled: false })).toMatchObject({ ai_runtime_enabled: true, ai_research_enabled: false })
  })
})
